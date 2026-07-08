import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import {
  consumeKeyringDowngradeWarning,
  consumeLegacyStorageWarning,
  readProfileRecord,
} from "../core/auth/storage";
import {
  createCredentialRefresher,
  isPreflightSkipped,
  resolveConfig,
  SKIP_PREFLIGHT_ENV,
  type ConfigFlags,
  type ResolvedConfig,
} from "../core/config";
import { consumeLegacyEnvWarnings } from "../core/env";
import { ConfigError } from "../core/errors";
import { createClient, type Client } from "../core/http/client";
import { HttpError } from "../core/http/errors";
import { OAUTH_SCOPE } from "../core/http/oauth";
import {
  BASELINE_CAPABILITIES,
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "../core/version/capabilities";
import { CapabilityError } from "../core/version/preflight-error";
import { type ServerInfo } from "../core/version/probe";
import { reportError } from "../output/error";
import { warn } from "../output/notice";
import { setMetabaseAugment, type SkillPointer } from "../runtime/command-augment";

import { resolveCommonFlags, type CommonArgs, type CommonContext } from "./context";
import { assertKnownFlags } from "./known-flags";

export { SKIP_PREFLIGHT_ENV };

export interface MetabaseCommandContext<A extends ArgsDef> {
  args: ParsedArgs<A>;
  ctx: CommonContext;
  getClient: () => Promise<Client>;
  getResolvedConfig: () => Promise<ResolvedConfig>;
  getServerInfo: () => Promise<ServerInfo | null>;
}

export interface MetabaseCommandDef<A extends ArgsDef> {
  meta: CommandMeta;
  args: A;
  examples?: readonly string[];
  details?: string;
  skills?: readonly SkillPointer[];
  inputSchema?: ZodType;
  outputSchema?: ZodType;
  capabilities?: Partial<Capabilities> | null;
  run: (context: MetabaseCommandContext<A>) => Promise<void> | void;
}

export function defineMetabaseCommand<const A extends ArgsDef>(
  def: MetabaseCommandDef<A>,
): CommandDef<A> {
  const required: Capabilities | null =
    def.capabilities === null ? null : mergeCapabilities(def.capabilities);
  const cmd = defineCommand<A>({
    meta: def.meta,
    args: def.args,
    async run({ args, rawArgs }) {
      let reportFormat: CommonContext["format"] | undefined;
      try {
        const ctx = resolveCommonFlags(pickCommonArgs(args));
        reportFormat = ctx.format;
        assertKnownFlags(rawArgs, def.args);
        let cachedConfig: ResolvedConfig | null = null;
        let cachedClient: Client | null = null;
        let cachedServerInfo: Promise<ServerInfo | null> | null = null;
        const getResolvedConfig = async (): Promise<ResolvedConfig> => {
          if (cachedConfig === null) {
            cachedConfig = await resolveConfig(buildConfigFlags(ctx));
          }
          return cachedConfig;
        };
        const getServerInfo = (): Promise<ServerInfo | null> => {
          if (cachedServerInfo === null) {
            cachedServerInfo = loadServerInfo(getResolvedConfig);
          }
          return cachedServerInfo;
        };
        const rawGetClient = async (): Promise<Client> => {
          if (cachedClient === null) {
            const resolved = await getResolvedConfig();
            cachedClient = createClient(
              { url: resolved.url, credential: resolved.credential },
              {
                getServerTag: async () => (await getServerInfo())?.version?.tag ?? null,
                refreshCredential: createCredentialRefresher(resolved.profile),
              },
            );
          }
          return cachedClient;
        };
        const enforcePreflight = createPreflightEnforcer(
          required,
          getServerInfo,
          ctx.skipPreflight,
        );
        const getClient = async (): Promise<Client> => {
          const client = await rawGetClient();
          await enforcePreflight();
          return client;
        };
        try {
          await def.run({
            args,
            ctx,
            getClient,
            getResolvedConfig,
            getServerInfo,
          });
        } catch (error) {
          throw enrichScopeForbiddenError(error, cachedConfig);
        } finally {
          emitPendingWarnings();
        }
      } catch (error) {
        reportError(error, reportFormat);
      }
    },
  });
  setMetabaseAugment(cmd, {
    examples: def.examples ?? [],
    details: def.details ? def.details : null,
    skills: def.skills ?? [],
    inputSchema: def.inputSchema ?? null,
    outputSchema: def.outputSchema ?? null,
    capabilities: required,
  });
  return cmd;
}

// A server-side 403 on a scope-narrowed profile is almost always the scope working as designed
// (the containment model 403s everything outside workspace CRUD), so name the real fix instead
// of letting the bare "Forbidden." suggest a permissions bug.
export function enrichScopeForbiddenError(error: unknown, config: ResolvedConfig | null): unknown {
  if (!(error instanceof HttpError) || error.status !== 403 || config === null) {
    return error;
  }
  const { credential } = config;
  if (credential.kind !== "oauth" || credential.scope === OAUTH_SCOPE) {
    return error;
  }
  return new ConfigError(
    `${error.userMessage} This profile's login is scoped to ${credential.scope}, which only allows workspace commands against this server. Run \`mb auth login\` for a full-access login, or point --profile at a workspace profile.`,
  );
}

function emitPendingWarnings(): void {
  for (const message of consumeLegacyEnvWarnings()) {
    warn(message);
  }
  const legacy = consumeLegacyStorageWarning();
  if (legacy !== null) {
    warn(legacy);
  }
  const downgrade = consumeKeyringDowngradeWarning();
  if (downgrade !== null) {
    warn(downgrade);
  }
}

async function loadServerInfo(
  getResolvedConfig: () => Promise<ResolvedConfig>,
): Promise<ServerInfo | null> {
  const resolved = await getResolvedConfig();
  const record = await readProfileRecord(resolved.profile);
  if (record === null || record.lastProbe === null) {
    return null;
  }
  return {
    version: record.lastProbe.version,
    tokenFeatures: record.lastProbe.tokenFeatures,
  };
}

const NO_OP_ENFORCER: () => Promise<void> = async () => {};

const NO_PROBE_DATA_WARNING =
  "Could not detect Metabase server version. Proceeding without preflight check; failures may produce confusing errors. Run `mb auth list` (or `mb auth login`) to populate the version cache.";

function createPreflightEnforcer(
  required: Capabilities | null,
  getServerInfo: () => Promise<ServerInfo | null>,
  skip: boolean,
): () => Promise<void> {
  if (required === null || skip || isPreflightSkipped() || isBaseline(required)) {
    return NO_OP_ENFORCER;
  }
  let done = false;
  return async () => {
    if (done) {
      return;
    }
    done = true;
    const info = await getServerInfo();
    if (info === null) {
      warn(NO_PROBE_DATA_WARNING);
      return;
    }
    const failure = checkCapabilities(info, required);
    if (failure === null || failure.reason === "unknown-version") {
      return;
    }
    throw new CapabilityError(failure);
  };
}

function isBaseline(caps: Capabilities): boolean {
  return caps.minVersion === BASELINE_CAPABILITIES.minVersion && caps.tokenFeature === undefined;
}

function pickCommonArgs<A extends ArgsDef>(args: ParsedArgs<A>): CommonArgs {
  const out: CommonArgs = {};
  if (typeof args["format"] === "string") {
    out.format = args["format"];
  }
  if (typeof args["json"] === "boolean") {
    out.json = args["json"];
  }
  if (typeof args["full"] === "boolean") {
    out.full = args["full"];
  }
  if (typeof args["fields"] === "string") {
    out.fields = args["fields"];
  }
  if (typeof args["maxBytes"] === "string") {
    out.maxBytes = args["maxBytes"];
  }
  if (typeof args["profile"] === "string") {
    out.profile = args["profile"];
  }
  if (typeof args["url"] === "string") {
    out.url = args["url"];
  }
  if (typeof args["apiKey"] === "string") {
    out.apiKey = args["apiKey"];
  }
  if (typeof args["skipPreflight"] === "boolean") {
    out.skipPreflight = args["skipPreflight"];
  }
  return out;
}

function buildConfigFlags(ctx: CommonContext): ConfigFlags {
  const flags: ConfigFlags = {};
  if (ctx.profile !== undefined) {
    flags.profile = ctx.profile;
  }
  if (ctx.url !== undefined) {
    flags.url = ctx.url;
  }
  if (ctx.apiKey !== undefined) {
    flags.apiKey = ctx.apiKey;
  }
  return flags;
}

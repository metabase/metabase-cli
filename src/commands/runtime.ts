import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import { consumeLegacyStorageWarning, readProfileRecord } from "../core/auth/storage";
import {
  isPreflightSkipped,
  resolveConfig,
  SKIP_PREFLIGHT_ENV,
  type ConfigFlags,
  type ResolvedConfig,
} from "../core/config";
import { createClient, type Client } from "../core/http/client";
import {
  BASELINE_CAPABILITIES,
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "../core/version/capabilities";
import { CapabilityError } from "../core/version/preflight-error";
import { EMPTY_SERVER_INFO, type ServerInfo } from "../core/version/probe";
import { reportError } from "../output/error";
import { warn } from "../output/notice";
import { setMetabaseAugment } from "../runtime/command-augment";

import { resolveCommonFlags, type CommonArgs, type CommonContext } from "./context";

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
    async run({ args }) {
      try {
        const ctx = resolveCommonFlags(pickCommonArgs(args));
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
              { url: resolved.url, apiKey: resolved.apiKey },
              {
                getServerTag: async () => (await getServerInfo())?.version?.tag ?? null,
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
        } finally {
          emitLegacyStorageWarningIfPending();
        }
      } catch (error) {
        reportError(error);
      }
    },
  });
  setMetabaseAugment(cmd, {
    examples: def.examples ?? [],
    details: def.details ? def.details : null,
    outputSchema: def.outputSchema ?? null,
    capabilities: required,
  });
  return cmd;
}

function emitLegacyStorageWarningIfPending(): void {
  const message = consumeLegacyStorageWarning();
  if (message !== null) {
    warn(message);
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
    edition: record.lastProbe.edition,
    tokenFeatures: record.lastProbe.tokenFeatures,
  };
}

const NO_OP_ENFORCER: () => Promise<void> = async () => {};

const PROBE_HINT = " Run `mb auth list` (or `mb auth login`) to populate the version cache.";

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
    const info = (await getServerInfo()) ?? EMPTY_SERVER_INFO;
    const failure = checkCapabilities(info, required);
    if (failure === null) {
      return;
    }
    if (failure.reason === "unknown-version") {
      warn(failure.detail + PROBE_HINT);
      return;
    }
    throw new CapabilityError(failure);
  };
}

function isBaseline(caps: Capabilities): boolean {
  return (
    caps.minVersion === BASELINE_CAPABILITIES.minVersion &&
    caps.edition === BASELINE_CAPABILITIES.edition &&
    caps.tokenFeature === undefined
  );
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

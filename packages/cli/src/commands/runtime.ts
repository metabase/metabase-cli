import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import type { MetabaseClient } from "@metabase/client/client";
import { MetabaseError, ResponseShapeError } from "@metabase/client/errors";
import { summarizeCapabilities } from "@metabase/client/version/capability-summary";
import type { FeatureName } from "@metabase/client/version/features";
import { CapabilityError } from "@metabase/client/version/preflight-error";
import { probeServer, type ServerInfo } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { checkFeatures } from "@metabase/client/version/requirement-check";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import type { ProfileLastProbe } from "../core/auth/profile-record";
import { ProfileRefreshedError, serverChangeNote, skewNotice } from "../core/auth/server-summary";
import { readCachedProbe } from "../core/auth/cached-server";
import {
  consumeKeyringDowngradeWarning,
  consumeLegacyStorageWarning,
  writeProbeResult,
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
import { USER_AGENT } from "../core/user-agent";
import { reportError } from "../output/error";
import { warn } from "../output/notice";
import {
  type CommandRequirements,
  setMetabaseAugment,
  type SkillPointer,
} from "../runtime/command-augment";
import { interruptSignal } from "../runtime/interrupt";
import {
  resolveCommonFlags,
  resolveOutputFormat,
  type CommonArgs,
  type CommonContext,
} from "./context";
import { assertKnownFlags } from "./known-flags";

export { SKIP_PREFLIGHT_ENV };

interface MetabaseCommandContext<A extends ArgsDef> {
  args: ParsedArgs<A>;
  ctx: CommonContext;
  getClient: () => Promise<MetabaseClient>;
  getResolvedConfig: () => Promise<ResolvedConfig>;
}

interface MetabaseCommandDef<A extends ArgsDef> {
  meta: CommandMeta;
  args: A;
  examples?: readonly string[];
  details?: string;
  skills?: readonly SkillPointer[];
  inputSchema?: ZodType;
  outputSchema?: ZodType;
  // `null` for a command that never reaches a server.
  requires: readonly MethodKey[] | null;
  run: (context: MetabaseCommandContext<A>) => Promise<void> | void;
}

export function defineMetabaseCommand<const A extends ArgsDef>(
  def: MetabaseCommandDef<A>,
): CommandDef<A> {
  const requirements = def.requires === null ? null : deriveRequirements(def.requires);
  const cmd = defineCommand<A>({
    meta: def.meta,
    args: def.args,
    async run({ args, rawArgs }) {
      const commonArgs = pickCommonArgs(args);
      let reportFormat: CommonContext["format"] | undefined;
      try {
        reportFormat = resolveOutputFormat(commonArgs);
        const ctx = resolveCommonFlags(commonArgs);
        assertKnownFlags(rawArgs, def.args);
        let cachedConfig: ResolvedConfig | null = null;
        let cachedClient: MetabaseClient | null = null;
        const getResolvedConfig = async (): Promise<ResolvedConfig> => {
          if (cachedConfig === null) {
            cachedConfig = await resolveConfig(buildConfigFlags(ctx));
          }
          return cachedConfig;
        };
        const preflightSkipped = ctx.skipPreflight || isPreflightSkipped();
        let cachedServer: CachedServer | null = null;
        const noticeSkew = createSkewNotifier();
        // Imported here rather than at the top of the file so the resource namespaces `createClient`
        // composes — and the whole `domain/` layer behind them — stay off the chunk every command
        // loads, including `--help`, a flag error, and the commands that open no socket at all.
        const rawGetClient = async (): Promise<MetabaseClient> => {
          if (cachedClient === null) {
            const resolved = await getResolvedConfig();
            const probe = await readCachedProbe(resolved.profile, resolved.url);
            const server = probe === null ? null : createServerProfile(probe);
            const { createClient } = await import("@metabase/client/client");
            cachedClient = createClient(
              { url: resolved.url, credential: resolved.credential },
              {
                userAgent: USER_AGENT,
                ...(server !== null && { server }),
                refreshCredential: createCredentialRefresher(resolved.profile),
                signal: interruptSignal,
                enforceRequirements: !preflightSkipped,
              },
            );
            if (probe !== null && server !== null) {
              cachedServer = { client: cachedClient, profileName: resolved.profile, probe };
              noticeSkew(server);
            }
          }
          return cachedClient;
        };
        const enforcePreflight = createPreflightEnforcer(
          requirements === null ? null : requirements.features,
          preflightSkipped,
          noticeSkew,
        );
        const getClient = async (): Promise<MetabaseClient> => {
          const client = await rawGetClient();
          await enforcePreflight(client);
          return client;
        };
        try {
          await def.run({
            args,
            ctx,
            getClient,
            getResolvedConfig,
          });
        } catch (error) {
          throw await refreshProfileOnStaleError(error, cachedServer);
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
    requires: requirements,
    capabilities: requirements === null ? null : summarizeCapabilities(requirements.features),
  });
  return cmd;
}

function deriveRequirements(methods: readonly MethodKey[]): CommandRequirements {
  const features = [...new Set(methods.flatMap((key) => methodRequirements(key)))];
  return { methods, features };
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

type SkewNotifier = (profile: ServerProfile) => void;

// The notice is about the server, not the command, so the first profile a command resolves —
// cached or freshly probed — is the one that speaks, and only once.
function createSkewNotifier(): SkewNotifier {
  let noticed = false;
  return (profile) => {
    if (noticed) {
      return;
    }
    noticed = true;
    const notice = skewNotice(profile);
    if (notice !== null) {
      warn(notice);
    }
  };
}

type PreflightEnforcer = (client: MetabaseClient) => Promise<void>;

const NO_OP_ENFORCER: PreflightEnforcer = async () => {};

// Raises the refusal the client's own `require()` would raise on the first gated call, so a
// command fails before it has done any work.
function createPreflightEnforcer(
  features: readonly FeatureName[] | null,
  skip: boolean,
  noticeSkew: SkewNotifier,
): PreflightEnforcer {
  if (features === null || skip || features.length === 0) {
    return NO_OP_ENFORCER;
  }
  let done = false;
  return async (client) => {
    if (done) {
      return;
    }
    done = true;
    const profile = await client.server();
    noticeSkew(profile);
    const failure = checkFeatures(features, profile);
    if (failure !== null) {
      throw new CapabilityError(failure);
    }
  };
}

// The client and the cached probe it was built on, kept for the one re-probe a shape error earns.
interface CachedServer {
  client: MetabaseClient;
  profileName: string;
  probe: ProfileLastProbe;
}

// A shape error or a refusal under a cached profile may mean the server changed since the probe.
// One fresh probe settles it: a changed server is written back and the error says so. The command
// is not retried — its request may have been a write.
async function refreshProfileOnStaleError(
  error: unknown,
  cached: CachedServer | null,
): Promise<unknown> {
  if (cached === null) {
    return error;
  }
  if (!(error instanceof ResponseShapeError) && !(error instanceof CapabilityError)) {
    return error;
  }
  const note = await refreshChangedProbe(cached);
  return note === null ? error : new ProfileRefreshedError(error, note);
}

async function refreshChangedProbe(cached: CachedServer): Promise<string | null> {
  let fresh: ServerInfo;
  try {
    fresh = await probeServer(cached.client);
  } catch (error) {
    // A diagnosis on the way out: a server that cannot be reached or answered now must not
    // displace the shape error the user is here for. Anything else is a bug and surfaces.
    if (error instanceof MetabaseError) {
      return null;
    }
    throw error;
  }
  const note = serverChangeNote(cached.probe, fresh);
  if (note === null) {
    return null;
  }
  await writeProbeResult(cached.profileName, { user: cached.probe.user, server: fresh });
  return note;
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
  if (typeof args["limit"] === "string") {
    out.limit = args["limit"];
  }
  if (typeof args["offset"] === "string") {
    out.offset = args["offset"];
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

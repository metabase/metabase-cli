import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import type { MetabaseClient } from "@metabase/client/client";
import { MetabaseError, ResponseShapeError } from "@metabase/client/errors";
import type { FeatureName } from "@metabase/client/version/features";
import { CapabilityError } from "@metabase/client/version/preflight-error";
import { probeServer, type ServerInfo } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { checkFeatures } from "@metabase/client/version/requirement-check";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import {
  isPreflightSkipped,
  resolveConfig,
  SKIP_PREFLIGHT_ENV,
  type ResolvedConfig,
} from "../core/config";
import { ProbeRefreshedError } from "../core/probe-refreshed-error";
import { cachedServerLookup, probeAndCacheServer, writeCachedProbe } from "../core/server-cache";
import { serverChangeNote, skewNotice } from "../core/server-summary";
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
            cachedConfig = await resolveConfig({ signal: interruptSignal });
          }
          return cachedConfig;
        };
        const preflightSkipped = ctx.skipPreflight || isPreflightSkipped();
        const wantsProbe =
          !preflightSkipped && requirements !== null && requirements.features.length > 0;
        let cachedServer: CachedServer | null = null;
        const noticeSkew = createSkewNotifier();
        // Imported here rather than at the top of the file so the resource namespaces `createClient`
        // composes — and the whole `domain/` layer behind them — stay off the chunk every command
        // loads, including `--help`, a flag error, and the commands that open no socket at all.
        const rawGetClient = async (): Promise<MetabaseClient> => {
          if (cachedClient === null) {
            const resolved = await getResolvedConfig();
            const { createClient } = await import("@metabase/client/client");
            const credentials = { url: resolved.url, credential: resolved.credential };
            const options = {
              userAgent: USER_AGENT,
              signal: interruptSignal,
              enforceRequirements: !preflightSkipped,
              worktreeId: resolved.worktreeId,
              ...(resolved.refreshCredential !== null && {
                refreshCredential: resolved.refreshCredential,
              }),
            };
            // A gated command with nothing cached probes once; a command whose methods need nothing
            // never probes, so it still runs against a server the CLI cannot ask for its properties.
            const lookup =
              (await cachedServerLookup(resolved.url)) ??
              (wantsProbe
                ? await probeAndCacheServer(resolved.url, () =>
                    probeServer(createClient(credentials, options)),
                  )
                : null);
            const server = lookup === null ? null : createServerProfile(lookup.probe);
            cachedClient = createClient(credentials, {
              ...options,
              ...(server !== null && { server }),
            });
            if (lookup !== null && server !== null) {
              if (lookup.source === "cache") {
                cachedServer = { client: cachedClient, url: resolved.url, probe: lookup.probe };
              }
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
          await def.run({ args, ctx, getClient });
        } catch (error) {
          throw await refreshProbeOnStaleError(error, cachedServer);
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
  });
  return cmd;
}

function deriveRequirements(methods: readonly MethodKey[]): CommandRequirements {
  const features = [...new Set(methods.flatMap((key) => methodRequirements(key)))];
  return { methods, features };
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
  url: string;
  probe: ServerInfo;
}

// A shape error or a refusal under a cached probe may mean the server changed since the probe.
// One fresh probe settles it: a changed server is written back and the error says so. The command
// is not retried — its request may have been a write.
async function refreshProbeOnStaleError(
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
  return note === null ? error : new ProbeRefreshedError(error, note);
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
  await writeCachedProbe(cached.url, fresh, Date.now());
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
  if (typeof args["skipPreflight"] === "boolean") {
    out.skipPreflight = args["skipPreflight"];
  }
  return out;
}

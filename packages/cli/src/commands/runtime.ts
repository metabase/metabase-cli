import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import type { MetabaseClient } from "@metabase/client/client";
import {
  AbortError,
  errorMessage,
  MetabaseError,
  ResponseShapeError,
} from "@metabase/client/errors";
import type { ServerInfo } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import type { ProfileLastProbe } from "../core/auth/profile-record";
import { ProfileRefreshedError } from "../core/profile-refreshed-error";
import { serverChangeNote, skewNotice } from "../core/auth/server-summary";
import { readCachedProbe } from "../core/auth/cached-server";
import {
  consumeKeyringDowngradeWarning,
  consumeLegacyStorageWarning,
  writeProbeResult,
} from "../core/auth/storage";
import {
  createCredentialRefresher,
  resolveConfig,
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
import { assertArgv, givenFlagKeys } from "./argv";

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
      const commonArgs = pickCommonArgs(args, givenFlagKeys(rawArgs, def.args));
      let reportFormat: CommonContext["format"] | undefined;
      try {
        reportFormat = resolveReportFormat(commonArgs, rawArgs, def.args);
        assertArgv(rawArgs, def.args);
        const ctx = resolveCommonFlags(commonArgs);
        let cachedConfig: ResolvedConfig | null = null;
        let cachedClient: MetabaseClient | null = null;
        const getResolvedConfig = async (): Promise<ResolvedConfig> => {
          if (cachedConfig === null) {
            cachedConfig = await resolveConfig(buildConfigFlags(ctx));
          }
          return cachedConfig;
        };
        let cachedServer: CachedServer | null = null;
        const noticeSkew = createSkewNotifier();
        // Imported here rather than at the top of the file so the resource namespaces
        // `createClient` composes — and the whole `domain/` layer behind them — stay off the chunk
        // every command loads, including `--help`, a flag error, and the commands that open no
        // socket at all.
        const getClient = async (): Promise<MetabaseClient> => {
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
                onServerProbed: async (fresh) => {
                  noticeSkew(createServerProfile(fresh));
                  if (probe !== null) {
                    await persistChangedProbe(resolved.profile, probe, fresh);
                  }
                },
                signal: interruptSignal,
              },
            );
            if (probe !== null && server !== null) {
              cachedServer = { client: cachedClient, probe };
              noticeSkew(server);
            }
          }
          return cachedClient;
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

// The notice is about the server, not the command, so the first profile a run learns — the cached
// one when the client is built, or else the first probe — speaks, and only once.
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

// Every probe the client runs is the server's own word, so one that disagrees with the cache
// replaces it: a refusal explained today must not leave the skills filter and the shape choices of
// the next run on yesterday's server. The cache is a convenience, so a write that fails warns
// rather than failing the command the probe served.
async function persistChangedProbe(
  profileName: string,
  cached: ProfileLastProbe,
  fresh: ServerInfo,
): Promise<void> {
  if (serverChangeNote(cached, fresh) === null) {
    return;
  }
  try {
    await writeProbeResult(profileName, { user: cached.user, server: fresh });
  } catch (error) {
    warn(
      `Could not save the server's new probe to profile "${profileName}": ${errorMessage(error)}`,
    );
  }
}

// The client and the cached probe it was built on, kept for the one re-probe a shape error earns.
interface CachedServer {
  client: MetabaseClient;
  probe: ProfileLastProbe;
}

// A shape error under a cached profile may mean the server changed since the probe, and the shape
// was chosen for the old one. One fresh probe settles it: the client writes a changed server back
// and the error says so. The command is not retried — its request may have been a write.
async function refreshProfileOnStaleError(
  error: unknown,
  cached: CachedServer | null,
): Promise<unknown> {
  if (cached === null) {
    return error;
  }
  if (!(error instanceof ResponseShapeError)) {
    return error;
  }
  const note = await refreshChangedProbe(cached);
  return note === null ? error : new ProfileRefreshedError(error, note);
}

async function refreshChangedProbe(cached: CachedServer): Promise<string | null> {
  let fresh: ServerProfile;
  try {
    fresh = await cached.client.verifiedServer();
  } catch (error) {
    // A diagnosis on the way out: a server that cannot be reached or answered now must not
    // displace the shape error the user is here for. An interrupt is the user's own and ends the
    // command as one; anything else is a bug and surfaces.
    if (error instanceof MetabaseError && !(error instanceof AbortError)) {
      return null;
    }
    throw error;
  }
  return serverChangeNote(cached.probe, fresh);
}

// The error report takes the format the flags ask for, so it is resolved before argv is checked.
// A `--format` that swallowed the next flag is an argv mistake, though, and is named as one.
function resolveReportFormat(
  commonArgs: CommonArgs,
  rawArgs: readonly string[],
  argsDef: ArgsDef,
): CommonContext["format"] {
  try {
    return resolveOutputFormat(commonArgs);
  } catch (error) {
    assertArgv(rawArgs, argsDef);
    throw error;
  }
}

function pickCommonArgs<A extends ArgsDef>(
  args: ParsedArgs<A>,
  given: ReadonlySet<string>,
): CommonArgs {
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
  // citty fills the default in; only a typed --max-bytes counts, so a command whose output it
  // cannot cap can refuse it.
  if (typeof args["maxBytes"] === "string" && given.has("maxBytes")) {
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

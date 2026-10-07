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
import { HttpError } from "@metabase/client/http/errors";
import type { ServerInfo } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import type { ProfileLastProbe } from "../core/auth/profile-record";
import { ProfileRefreshedError } from "../core/profile-refreshed-error";
import { sameServer, serverChangeNote, skewNotice } from "../core/auth/server-summary";
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
        const getResolvedConfig = async (): Promise<ResolvedConfig> => {
          if (cachedConfig === null) {
            cachedConfig = await resolveConfig(buildConfigFlags(ctx));
          }
          return cachedConfig;
        };
        const run: RunState = { server: null, writes: Promise.resolve() };
        const noticeSkew = createSkewNotifier();
        // Imported here rather than at the top of the file so the resource namespaces
        // `createClient` composes — and the whole `domain/` layer behind them — stay off the chunk
        // every command loads, including `--help`, a flag error, and the commands that open no
        // socket at all.
        const getClient = async (): Promise<MetabaseClient> => {
          if (run.server !== null) {
            return run.server.client;
          }
          const resolved = await getResolvedConfig();
          const probe = await readCachedProbe(resolved.profile, resolved.url);
          const server = probe === null ? null : createServerProfile(probe);
          const saveProbe = probe === null ? null : createProbeSaver(resolved.profile, probe);
          const { createClient } = await import("@metabase/client/client");
          const client = createClient(
            { url: resolved.url, credential: resolved.credential },
            {
              userAgent: USER_AGENT,
              ...(server !== null && { server }),
              refreshCredential: createCredentialRefresher(resolved.profile),
              onServerProbed: (fresh, profile) => {
                noticeSkew(profile);
                if (saveProbe !== null) {
                  run.writes = run.writes.then(() => saveProbe(fresh));
                }
              },
              signal: interruptSignal,
            },
          );
          run.server = { client, cachedProbe: probe };
          if (server !== null) {
            noticeSkew(server);
          }
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
          throw await diagnoseFailure(error, run);
        } finally {
          await run.writes;
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

type ProbeSaver = (fresh: ServerInfo) => Promise<void>;

// A probe that finds the server changed since the cache was written is saved, so the skills filter
// and the next run's shape choices read the server as it is; one that agrees with the cache is not,
// so a run that probes rewrites the profiles file only when it has something new to say. The cache
// is a convenience, so a write that fails warns rather than failing the command the probe served.
function createProbeSaver(profileName: string, cached: ProfileLastProbe): ProbeSaver {
  let current: ServerInfo = cached;
  return async (fresh) => {
    if (sameServer(current, fresh)) {
      return;
    }
    current = fresh;
    try {
      await writeProbeResult(profileName, { user: cached.user, server: fresh });
    } catch (error) {
      warn(
        `Could not save the server's new probe to profile "${profileName}": ${errorMessage(error)}`,
      );
    }
  };
}

// What a run knows of its server once the client is built, and the cache writes the client's probes
// have queued, which the run waits on before it ends.
interface RunState {
  server: RunServer | null;
  writes: Promise<void>;
}

interface RunServer {
  client: MetabaseClient;
  cachedProbe: ProfileLastProbe | null;
}

// A failure that skew could explain earns the probe that names the server, on the way out; it is
// free once the run has probed, because the client keeps its probe. With no cached profile the
// probe only lets the skew notice speak. Under one, only a shape read under that profile's tag is
// worth it: a probe settled mid-run with the same tag at worst adds a needless note. The command is
// never retried, because its request may have been a write.
async function diagnoseFailure(error: unknown, run: RunState): Promise<unknown> {
  if (run.server === null || !isSkewSymptom(error)) {
    return error;
  }
  const { client, cachedProbe } = run.server;
  if (cachedProbe === null) {
    await probeOnTheWayOut(client);
    return error;
  }
  const detail = error instanceof ResponseShapeError ? error.developerDetail : null;
  if (detail === null || detail.kind !== "zod" || detail.serverTag !== cachedProbe.version.tag) {
    return error;
  }
  const fresh = await probeOnTheWayOut(client);
  if (fresh === null) {
    return error;
  }
  const note = serverChangeNote(cachedProbe, fresh, detail.method);
  return note === null ? error : new ProfileRefreshedError(error, note);
}

function isSkewSymptom(error: unknown): error is MetabaseError {
  if (error instanceof ResponseShapeError) {
    return true;
  }
  return error instanceof HttpError && error.kind === "route-missing";
}

// A diagnosis on the way out: a server that cannot be reached or answered now must not displace
// the error the user is here for. An interrupt is the user's own and ends the command as one;
// anything else is a bug and surfaces.
async function probeOnTheWayOut(client: MetabaseClient): Promise<ServerProfile | null> {
  try {
    return await client.verifiedServer();
  } catch (error) {
    if (error instanceof MetabaseError && !(error instanceof AbortError)) {
      return null;
    }
    throw error;
  }
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

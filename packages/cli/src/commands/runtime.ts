import { defineCommand } from "citty";
import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty";
import type { ZodType } from "zod";

import type { MetabaseClient } from "@metabase/client/client";
import { errorMessage, isNonInterruptFailure, ResponseShapeError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import type { ClientOptions, SkippedPreflight } from "@metabase/client/http/transport";
import type { ServerInfo } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import type { ProfileLastProbe } from "../core/auth/profile-record";
import { ProfileRefreshedError } from "../core/profile-refreshed-error";
import {
  type ProfileState,
  sameServer,
  serverChangeNote,
  skewNotice,
} from "../core/auth/server-summary";
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
import { consumeLegacyEnvWarnings, ENV_SKIP_PREFLIGHT, readEnv } from "../core/env";
import { USER_AGENT } from "../core/user-agent";
import { reportError } from "../output/error";
import { preflightSkippedNotice, preflightUncheckedNotice, warn } from "../output/notice";
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
        const run: RunState = { server: null, profileSave: Promise.resolve("current") };
        const noticeSkew = createSkewNotifier();
        const skipPreflight = ctx.skipPreflight ?? readEnv(ENV_SKIP_PREFLIGHT) === "1";
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
                  run.profileSave = run.profileSave.then(() => saveProbe(fresh));
                }
              },
              ...(skipPreflight && { onPreflightSkipped: createPreflightSkipWarner() }),
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
          await settleRun(run);
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

type PreflightSkipWarner = NonNullable<ClientOptions["onPreflightSkipped"]>;

// A check a run skips on every page of a walk, or on each of several calls, carries one risk, so
// each distinct refusal warns once, and a server that could not be checked warns once whatever
// each failed probe said.
function createPreflightSkipWarner(): PreflightSkipWarner {
  const warned = new Set<string>();
  return (skipped) => {
    const notice = skippedPreflightNotice(skipped);
    const key = skipped.kind === "unverified" ? skipped.kind : notice;
    if (warned.has(key)) {
      return;
    }
    warned.add(key);
    warn(notice);
  };
}

function skippedPreflightNotice(skipped: SkippedPreflight): string {
  if (skipped.kind === "refused") {
    return preflightSkippedNotice(skipped.refusal.message);
  }
  return preflightUncheckedNotice(skipped.failure.message);
}

type ProbeSaver = (fresh: ServerInfo) => Promise<ProfileState>;

// A probe that finds the server changed since the cache was written is saved, so the skills filter
// and the next run's shape choices read the server as it is; one that agrees with the cache is not,
// so a run that probes rewrites the profiles file only when it has something new to say. The cache
// is a convenience, so a write that fails warns rather than failing the command the probe served.
// Each save answers whether the profile now holds what that probe said, which a probe agreeing with
// the last one saved inherits from that save.
function createProbeSaver(profileName: string, cached: ProfileLastProbe): ProbeSaver {
  let current: ServerInfo = cached;
  let state: ProfileState = "current";
  return async (fresh) => {
    if (sameServer(current, fresh)) {
      return state;
    }
    current = fresh;
    try {
      await writeProbeResult(profileName, { user: cached.user, server: fresh });
      state = "current";
    } catch (error) {
      warn(
        `Could not save the server's new probe to profile "${profileName}": ${errorMessage(error)}`,
      );
      state = "stale";
    }
    return state;
  };
}

// What a run knows of its server once the client is built, and the newest profile save the client's
// probes have queued, which settles after every save queued before it and which the run waits on
// before it ends.
interface RunState {
  server: RunServer | null;
  profileSave: Promise<ProfileState>;
}

// A probe still in flight when the command ends may yet queue a save, which the process exiting
// right after would cut off midway, so the run waits for its probes before the saves they queued,
// and goes round again when a save was queued while it waited.
async function settleRun(run: RunState): Promise<void> {
  let awaited: Promise<ProfileState> | null = null;
  while (awaited !== run.profileSave) {
    if (run.server !== null) {
      await run.server.client.probesSettled();
    }
    awaited = run.profileSave;
    await awaited;
  }
}

interface RunServer {
  client: MetabaseClient;
  cachedProbe: ProfileLastProbe | null;
}

// A failure that skew could explain earns the probe that names the server, on the way out; it is
// free once the run has probed, because the client keeps its probe. With no cached profile the
// probe only lets the skew notice speak. Under one, only a shape read under that profile's tag is
// worth it: a probe settled mid-run with the same tag at worst adds a needless note. The note
// waits for that probe's save, queued before the probe answers, since it tells the user whether
// the profile now holds it. The command is never retried, because its request may have been a
// write.
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
  const note = serverChangeNote(cachedProbe, fresh, detail.method, await run.profileSave);
  return note === null ? error : new ProfileRefreshedError(error, note);
}

function isSkewSymptom(error: unknown): error is ResponseShapeError | HttpError {
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
    if (isNonInterruptFailure(error)) {
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

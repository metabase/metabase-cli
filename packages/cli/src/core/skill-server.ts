import { ConfigError, MetabaseError } from "@metabase/client/errors";
import { probeServer } from "@metabase/client/version/probe";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";

import { type ResolvedConfig, resolveConfig } from "./config";
import { cachedServerLookup, probeAndCacheServer } from "./server-cache";
import { USER_AGENT } from "./user-agent";
import { interruptSignal } from "../runtime/interrupt";

interface ServerProfileFound {
  kind: "found";
  profile: ServerProfile;
}

interface NoCredential {
  kind: "no-credential";
  reason: string;
}

interface ServerUnreachable {
  kind: "unreachable";
  reason: string;
}

export type SkillServerLookup = ServerProfileFound | NoCredential | ServerUnreachable;

// The skills are readable without a server, so neither a missing credential nor a server that
// cannot be reached ends the command: both read as "nothing to filter by" with the reason kept
// for the notice.
export async function resolveSkillServer(): Promise<SkillServerLookup> {
  let resolved: ResolvedConfig;
  try {
    resolved = await resolveConfig({ signal: interruptSignal });
  } catch (error) {
    if (error instanceof ConfigError) {
      return { kind: "no-credential", reason: error.userMessage };
    }
    throw error;
  }
  try {
    const { createClient } = await import("@metabase/client/client");
    const client = createClient(
      { url: resolved.url, credential: resolved.credential },
      {
        userAgent: USER_AGENT,
        signal: interruptSignal,
        worktreeId: resolved.worktreeId,
        ...(resolved.refreshCredential !== null && {
          refreshCredential: resolved.refreshCredential,
        }),
      },
    );
    const lookup =
      (await cachedServerLookup(resolved.url)) ??
      (await probeAndCacheServer(resolved.url, () => probeServer(client)));
    return { kind: "found", profile: createServerProfile(lookup.probe) };
  } catch (error) {
    if (error instanceof MetabaseError) {
      return { kind: "unreachable", reason: error.userMessage };
    }
    throw error;
  }
}

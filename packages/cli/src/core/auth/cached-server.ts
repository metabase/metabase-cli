import { normalizeUrl } from "@metabase/client/url";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";

import { readEnvCredentials } from "../config";
import type { ProfileLastProbe } from "./profile-record";
import { readProfileRecord } from "./storage";

// The record's probe describes the record's server, and only that one: a URL from a flag or the
// environment can point the same profile name at another host, whose features and shapes the
// cached probe says nothing about. `null` when there is no probe to trust.
export async function readCachedProbe(
  profileName: string,
  url: string | null,
): Promise<ProfileLastProbe | null> {
  const record = await readProfileRecord(profileName);
  if (record === null || record.lastProbe === null) {
    return null;
  }
  if (url !== null && normalizeUrl(record.url) !== url) {
    return null;
  }
  return record.lastProbe;
}

// For a command that takes no `--url` and so can only be pointed elsewhere by the environment.
// Nothing here reaches the network.
export async function readCachedServerProfile(profileName: string): Promise<ServerProfile | null> {
  const envUrl = readEnvCredentials().url;
  const probe = await readCachedProbe(profileName, envUrl === null ? null : normalizeUrl(envUrl));
  return probe === null ? null : createServerProfile(probe);
}

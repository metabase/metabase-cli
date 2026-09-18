import { normalizeUrl } from "@metabase/client/url";
import { createServerProfile, type ServerProfile } from "@metabase/client/version/profile";

import { readEnvCredentials } from "../config";
import type { ProfileLastProbe } from "./profile-record";
import { readProfileRecord } from "./storage";

interface CachedProbeFound {
  kind: "found";
  probe: ProfileLastProbe;
}

interface NoProfileRecord {
  kind: "no-profile";
}

interface ProfileNeverProbed {
  kind: "never-probed";
}

// The record's probe describes the record's server, and only that one: a URL from a flag or the
// environment can point the same profile name at another host, whose features and shapes the
// cached probe says nothing about.
interface ProbeForOtherUrl {
  kind: "other-url";
  url: string;
}

export type CachedProbeMiss = NoProfileRecord | ProfileNeverProbed | ProbeForOtherUrl;
type CachedProbeLookup = CachedProbeFound | CachedProbeMiss;

interface CachedServerFound {
  kind: "found";
  profile: ServerProfile;
}

export type CachedServerProfile = CachedServerFound | CachedProbeMiss;

async function lookupCachedProbe(
  profileName: string,
  url: string | null,
): Promise<CachedProbeLookup> {
  const record = await readProfileRecord(profileName);
  if (record === null) {
    return { kind: "no-profile" };
  }
  if (record.lastProbe === null) {
    return { kind: "never-probed" };
  }
  if (url !== null && normalizeUrl(record.url) !== url) {
    return { kind: "other-url", url };
  }
  return { kind: "found", probe: record.lastProbe };
}

// `null` when there is no probe to trust.
export async function readCachedProbe(
  profileName: string,
  url: string | null,
): Promise<ProfileLastProbe | null> {
  const hit = await lookupCachedProbe(profileName, url);
  return hit.kind === "found" ? hit.probe : null;
}

// For a command that takes no `--url` and so can only be pointed elsewhere by the environment.
// Nothing here reaches the network.
export async function readCachedServerProfile(profileName: string): Promise<CachedServerProfile> {
  const envUrl = readEnvCredentials().url;
  const hit = await lookupCachedProbe(profileName, envUrl === null ? null : normalizeUrl(envUrl));
  if (hit.kind !== "found") {
    return hit;
  }
  return { kind: "found", profile: createServerProfile(hit.probe) };
}

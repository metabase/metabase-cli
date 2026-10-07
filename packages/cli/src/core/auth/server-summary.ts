import { z } from "zod";

import { TokenFeatures } from "@metabase/client/domain/session-properties";
import { Features } from "@metabase/client/version/features";
import type { ServerInfo } from "@metabase/client/version/probe";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import { createServerProfile, type ServerProfile, Skew } from "@metabase/client/version/profile";
import { describeVersion, Edition, ServerVersion } from "@metabase/client/version/tag";

const KnownRange = z.object({
  min: z.number().int(),
  max: z.number().int(),
});

// Derived from the probe when read, never stored — a persisted derivation would outlive the CLI
// that wrote it. Every server field is `null` without a probe; `knownRange` is the CLI's own.
export const ServerSummary = z.object({
  version: ServerVersion.nullable(),
  edition: Edition.nullable(),
  skew: Skew.nullable(),
  knownRange: KnownRange,
  tokenFeatures: TokenFeatures.nullable(),
  features: Features.nullable(),
});
export type ServerSummary = z.infer<typeof ServerSummary>;

export function summarizeServer(info: ServerInfo | null): ServerSummary {
  if (info === null) {
    return {
      version: null,
      edition: null,
      skew: null,
      knownRange: KNOWN_RANGE,
      tokenFeatures: null,
      features: null,
    };
  }
  const profile = createServerProfile(info);
  return {
    version: profile.version,
    edition: profile.edition,
    skew: profile.skew,
    knownRange: KNOWN_RANGE,
    tokenFeatures: profile.tokenFeatures,
    features: profile.features,
  };
}

// One line for a release outside the window this CLI was built against, or `null` otherwise. A
// development build gets none: it is the server this CLI is developed against, and `auth status`
// still names it.
export function skewNotice(profile: ServerProfile): string | null {
  const { min, max } = KNOWN_RANGE;
  switch (profile.skew) {
    case "supported":
    case "development": {
      return null;
    }
    case "older-than-known": {
      return `Metabase ${describeVersion(profile.version)} is older than this CLI supports (v${min}+); a command relying on a newer feature may fail. Upgrade Metabase to v${min} or later.`;
    }
    case "newer-than-known": {
      return `Metabase ${describeVersion(profile.version)} is newer than this CLI supports (up to v${max}); commands run as if it were v${max + 1}. Run \`mb upgrade\` for a newer CLI.`;
    }
  }
}

const PROFILE_REFRESHED = "the profile was refreshed";
const PROFILE_STALE = "the profile could not be updated (the warning above says why)";
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

// Whether the profile record holds what the newest probe said: it did already or the save landed
// (`current`), or the save failed (`stale`).
export type ProfileState = "current" | "stale";

// What a feature switch reads off a probe.
type ServerIdentity = Pick<ServerInfo, "version" | "tokenFeatures">;

/** Whether two probes agree on everything a feature switch reads: the version tag and the premium features. */
export function sameServer(a: ServerIdentity, b: ServerIdentity): boolean {
  return (
    describeVersion(a.version) === describeVersion(b.version) &&
    sameTokenFeatures(a.tokenFeatures, b.tokenFeatures)
  );
}

// What a fresh probe says that the cached one did not, with what to do about a request of `method`
// read under the cached one, or `null` when the two are the same server. A read is safe to repeat;
// a write the server answered may have landed, and repeating it could apply it twice. A profile
// left `stale` would choose the same shape again, so a read is worth repeating only once the save
// can land.
export function serverChangeNote(
  cached: ServerIdentity,
  fresh: ServerIdentity,
  method: string,
  profile: ProfileState,
): string | null {
  if (sameServer(cached, fresh)) {
    return null;
  }
  const remedy = changeRemedy(SAFE_METHODS.has(method), profile);
  const before = describeVersion(cached.version);
  const after = describeVersion(fresh.version);
  if (before !== after) {
    return `The server's version changed since the last probe (was ${before}, now ${after}); ${remedy}`;
  }
  return `The server's premium features changed since the last probe; ${remedy}`;
}

function changeRemedy(isSafe: boolean, profile: ProfileState): string {
  if (profile === "current") {
    return isSafe
      ? `${PROFILE_REFRESHED} — retry the command.`
      : `${PROFILE_REFRESHED}, but the request may have been applied — check before retrying.`;
  }
  return isSafe
    ? `${PROFILE_STALE} — retry the command once it can be.`
    : `${PROFILE_STALE}, and the request may have been applied — check before retrying.`;
}

// Only a granted feature turns a switch on, so a map the server did not report, an empty one, and
// one that names a feature it denies all read the same.
function sameTokenFeatures(
  a: Readonly<TokenFeatures> | null,
  b: Readonly<TokenFeatures> | null,
): boolean {
  const grantedA = grantedFeatures(a);
  const grantedB = grantedFeatures(b);
  return grantedA.length === grantedB.length && grantedA.every((key, i) => key === grantedB[i]);
}

function grantedFeatures(features: Readonly<TokenFeatures> | null): string[] {
  if (features === null) {
    return [];
  }
  return Object.keys(features)
    .filter((key) => features[key] === true)
    .toSorted();
}

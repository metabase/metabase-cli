import type { TokenFeatures } from "@metabase/client/domain/session-properties";
import type { ServerInfo } from "@metabase/client/version/probe";
import { KNOWN_RANGE } from "@metabase/client/version/known-range";
import type { ServerProfile } from "@metabase/client/version/profile";
import type { ParsedVersion } from "@metabase/client/version/tag";

const UNPARSEABLE_VERSION_LABEL = "an unparseable version";

function versionLabel(version: ParsedVersion | null): string {
  return version === null ? UNPARSEABLE_VERSION_LABEL : version.tag;
}

// One line for a server outside the window this CLI was built against, or `null` inside it.
export function skewNotice(profile: ServerProfile): string | null {
  const { min, max } = KNOWN_RANGE;
  switch (profile.skew) {
    case "supported": {
      return null;
    }
    case "older-than-known": {
      return `Metabase ${versionLabel(profile.version)} is older than this CLI supports (v${min}+); commands needing a newer feature are refused by name. Upgrade Metabase to v${min} or later.`;
    }
    case "newer-than-known": {
      return `Metabase ${versionLabel(profile.version)} is newer than this CLI supports (up to v${max}); commands run as if it were a head build past v${max}.`;
    }
    case "unknown": {
      return `Could not parse the Metabase version; assuming it has every feature this CLI knows.`;
    }
  }
}

const PROBE_REFRESHED_REMEDY = "the cached server probe was refreshed — retry the command.";

// What a fresh probe says that the cached one did not, or `null` when the two agree on everything
// a feature switch reads: the version tag and the premium features.
export function serverChangeNote(cached: ServerInfo, fresh: ServerInfo): string | null {
  const before = versionLabel(cached.version);
  const after = versionLabel(fresh.version);
  if (before !== after) {
    return `The server's version changed since the last probe (was ${before}, now ${after}); ${PROBE_REFRESHED_REMEDY}`;
  }
  if (!sameTokenFeatures(cached.tokenFeatures, fresh.tokenFeatures)) {
    return `The server's premium features changed since the last probe; ${PROBE_REFRESHED_REMEDY}`;
  }
  return null;
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

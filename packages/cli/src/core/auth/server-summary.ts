import { z } from "zod";

import { TokenFeatures } from "@metabase/client/domain/session-properties";
import { Features } from "@metabase/client/version/features";
import type { ServerInfo } from "@metabase/client/version/probe";
import {
  createServerProfile,
  KNOWN_RANGE,
  type ServerProfile,
  Skew,
} from "@metabase/client/version/profile";
import { Edition, ParsedVersion } from "@metabase/client/version/tag";

const KnownRange = z.object({
  min: z.number().int(),
  max: z.number().int(),
});

// What a probe says about the server, as every auth payload reports it: the raw facts and what
// this CLI derives from them, side by side. Derived when read, never stored — a persisted
// derivation would outlive the CLI that wrote it. Every server field is `null` without a probe;
// `knownRange` is the CLI's own and always present.
export const ServerSummary = z.object({
  version: ParsedVersion.nullable(),
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

const UNPARSEABLE_VERSION_LABEL = "an unparseable version";

function versionLabel(version: ParsedVersion | null): string {
  return version === null ? UNPARSEABLE_VERSION_LABEL : version.tag;
}

// One line for a server outside the window this CLI was built against, or `null` inside it.
export function skewNotice(profile: ServerProfile): string | null {
  const max = KNOWN_RANGE.max;
  switch (profile.skew) {
    case "supported": {
      return null;
    }
    case "newer-than-known": {
      return `Metabase ${versionLabel(profile.version)} is newer than this CLI supports (up to v${max}); commands run as if it were v${max}. Run \`mb upgrade\` for a newer CLI.`;
    }
    case "unknown": {
      return `Could not parse the Metabase version; assuming the newest supported (v${max}).`;
    }
  }
}

const PROFILE_REFRESHED_REMEDY = "the profile was refreshed — retry the command.";

// What a fresh probe says that the cached one did not, or `null` when the two agree on everything
// a feature switch reads: the version tag and the premium features.
export function serverChangeNote(cached: ServerInfo, fresh: ServerInfo): string | null {
  const before = versionLabel(cached.version);
  const after = versionLabel(fresh.version);
  if (before !== after) {
    return `The server's version changed since the last probe (was ${before}, now ${after}); ${PROFILE_REFRESHED_REMEDY}`;
  }
  if (!sameTokenFeatures(cached.tokenFeatures, fresh.tokenFeatures)) {
    return `The server's premium features changed since the last probe; ${PROFILE_REFRESHED_REMEDY}`;
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

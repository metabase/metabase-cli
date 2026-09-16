import { z } from "zod";

import { TokenFeatures } from "../domain/session-properties";

import {
  evaluateFeatures,
  FEATURE_RULES,
  type FeatureGap,
  type FeatureName,
  Features,
  ruleGap,
} from "./features";
import type { ServerInfo } from "./probe";
import { Edition, editionFromTag, ParsedVersion } from "./tag";

// The majors this client was built and tested against. A server above `max` is read as `max + 1`:
// its additions pass through the loose schemas, and a shape it changed fails loudly instead of
// being guessed at. A server below `min` keeps its real major so every feature it lacks is refused
// by name.
export const KNOWN_RANGE = { min: 58, max: 63 } as const;

export const Skew = z.enum(["supported", "newer-than-known", "unknown"]);
export type Skew = z.infer<typeof Skew>;

export const ServerProfile = z.object({
  version: ParsedVersion.nullable(),
  buildDate: z.string().nullable(),
  hash: z.string().nullable(),
  edition: Edition,
  tokenFeatures: TokenFeatures.nullable(),
  features: Features,
  skew: Skew,
});
export type ServerProfile = z.infer<typeof ServerProfile>;

interface Placement {
  readonly effectiveMajor: number;
  readonly skew: Skew;
}

export function createServerProfile(info: ServerInfo): ServerProfile {
  const placement = place(info.version);
  return {
    version: info.version,
    buildDate: info.date,
    hash: info.hash,
    edition: detectEdition(info),
    tokenFeatures: info.tokenFeatures,
    features: evaluateFeatures(placement.effectiveMajor, info.tokenFeatures),
    skew: placement.skew,
  };
}

// Why a profile lacks a feature — the same placement `createServerProfile` used, so the answer
// agrees with the boolean in `features`.
export function featureGap(profile: ServerProfile, feature: FeatureName): FeatureGap | null {
  const placement = place(profile.version);
  return ruleGap(FEATURE_RULES[feature], placement.effectiveMajor, profile.tokenFeatures);
}

function place(version: ParsedVersion | null): Placement {
  if (version === null) {
    return { effectiveMajor: KNOWN_RANGE.max + 1, skew: "unknown" };
  }
  if (version.major > KNOWN_RANGE.max) {
    return { effectiveMajor: KNOWN_RANGE.max + 1, skew: "newer-than-known" };
  }
  return { effectiveMajor: version.major, skew: "supported" };
}

// The tag is the authoritative signal. Head images and dev checkouts report `vUNKNOWN`, and
// `/api/session/properties` carries no other edition field — OSS sends the same all-false
// `token-features` map an unlicensed EE does — so for them the edition is whatever the token
// proves: a granted premium feature means EE, and an instance granting none behaves as OSS for
// everything this client can do.
function detectEdition(info: ServerInfo): Edition {
  const fromTag = info.version === null ? null : editionFromTag(info.version.tag);
  if (fromTag !== null) {
    return fromTag;
  }
  return grantsAnyFeature(info.tokenFeatures) ? "ee" : "oss";
}

function grantsAnyFeature(tokenFeatures: Readonly<TokenFeatures> | null): boolean {
  return tokenFeatures !== null && Object.values(tokenFeatures).some((enabled) => enabled);
}

import { z } from "zod";

import { TokenFeatures } from "../domain/session-properties";

import {
  evaluateFeatures,
  FEATURE_RULES,
  type FeatureGap,
  type FeatureName,
  Features,
  ruleGap,
  type RuleMajor,
} from "./features";
import { KNOWN_RANGE } from "./known-range";
import type { ServerInfo } from "./probe";
import { Edition, ServerVersion } from "./tag";

export const Skew = z.enum(["supported", "older-than-known", "newer-than-known", "development"]);
export type Skew = z.infer<typeof Skew>;

export const ServerProfile = z.object({
  version: ServerVersion,
  buildDate: z.string().nullable(),
  hash: z.string().nullable(),
  edition: Edition,
  tokenFeatures: TokenFeatures.nullable(),
  features: Features,
  skew: Skew,
});
export type ServerProfile = z.infer<typeof ServerProfile>;

interface Placement {
  readonly major: RuleMajor;
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
    features: evaluateFeatures(placement.major, info.tokenFeatures),
    skew: placement.skew,
  };
}

// Why a profile lacks a feature — the same placement `createServerProfile` used, so the answer
// agrees with the boolean in `features`.
export function featureGap(profile: ServerProfile, feature: FeatureName): FeatureGap | null {
  const placement = place(profile.version);
  return ruleGap(FEATURE_RULES[feature], placement.major, profile.tokenFeatures);
}

function place(version: ServerVersion): Placement {
  if (version.kind === "development") {
    return { major: "development", skew: "development" };
  }
  if (version.major > KNOWN_RANGE.max) {
    return { major: KNOWN_RANGE.max + 1, skew: "newer-than-known" };
  }
  if (version.major < KNOWN_RANGE.min) {
    return { major: version.major, skew: "older-than-known" };
  }
  return { major: version.major, skew: "supported" };
}

// The tag is authoritative. Where it stamps no edition, `/api/session/properties` carries no other
// edition field (OSS sends the same all-false `token-features` map an unlicensed EE does), so
// there the edition is whatever the token proves.
function detectEdition(info: ServerInfo): Edition {
  if (info.edition !== null) {
    return info.edition;
  }
  return grantsAnyFeature(info.tokenFeatures) ? "ee" : "oss";
}

function grantsAnyFeature(tokenFeatures: Readonly<TokenFeatures> | null): boolean {
  return tokenFeatures !== null && Object.values(tokenFeatures).some((enabled) => enabled);
}

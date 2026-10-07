import { FEATURE_RULES, type FeatureGap, type FeatureName, type FeatureRule } from "./features";
import {
  missingTokenFeatureMessage,
  type RequirementFailure,
  versionTooOldMessage,
} from "./capability-error";
import { featureGap, type ServerProfile } from "./profile";
import { describeVersion } from "./tag";

/** The first of `features` the profile lacks, or `null` when it has every one. */
export function checkFeatures(
  features: readonly FeatureName[],
  profile: ServerProfile,
): RequirementFailure | null {
  for (const feature of features) {
    const gap = featureGap(profile, feature);
    if (gap !== null) {
      return describeGap(gap, feature, profile);
    }
  }
  return null;
}

/**
 * The verdict that the profile has `feature`, which takes the value `detail` describes out of the
 * server's vocabulary, or `null` when the profile lacks it.
 */
export function supersedingFeature(
  feature: FeatureName,
  profile: ServerProfile,
  detail: string,
): RequirementFailure | null {
  if (featureGap(profile, feature) !== null) {
    return null;
  }
  const rule: FeatureRule = FEATURE_RULES[feature];
  return {
    reason: "superseded-by-feature",
    detail,
    feature,
    since: rule.since,
    tokenFeature: rule.tokenFeature ?? null,
    serverVersion: profile.version.tag,
  };
}

/**
 * Every one of `features` the profile lacks, each once and in the order given, so a caller that
 * goes on past the first still hears of the rest.
 */
export function featureFailures(
  features: readonly FeatureName[],
  profile: ServerProfile,
): RequirementFailure[] {
  return [...new Set(features)].flatMap((feature) => {
    const failure = checkFeatures([feature], profile);
    return failure === null ? [] : [failure];
  });
}

function describeGap(
  gap: FeatureGap,
  feature: FeatureName,
  profile: ServerProfile,
): RequirementFailure {
  const rule: FeatureRule = FEATURE_RULES[feature];
  const serverVersion = profile.version.tag;
  const tokenFeature = rule.tokenFeature ?? null;
  if (gap.kind === "token") {
    return {
      reason: "missing-token-feature",
      detail: missingTokenFeatureMessage(gap.tokenFeature),
      feature,
      since: rule.since,
      tokenFeature,
      serverVersion,
    };
  }
  return {
    reason: "version-too-old",
    detail: versionTooOldMessage(rule.since, describeVersion(profile.version)),
    feature,
    since: rule.since,
    tokenFeature,
    serverVersion,
  };
}

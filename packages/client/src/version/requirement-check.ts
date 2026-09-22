import { FEATURE_RULES, type FeatureGap, type FeatureName, type FeatureRule } from "./features";
import {
  missingTokenFeatureMessage,
  type RequirementFailure,
  versionTooOldMessage,
} from "./preflight-error";
import { featureGap, type ServerProfile } from "./profile";
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

function describeGap(
  gap: FeatureGap,
  feature: FeatureName,
  profile: ServerProfile,
): RequirementFailure {
  const rule: FeatureRule = FEATURE_RULES[feature];
  const serverVersion = profile.version === null ? null : profile.version.tag;
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
    detail: versionTooOldMessage(rule.since, serverVersion),
    feature,
    since: rule.since,
    tokenFeature,
    serverVersion,
  };
}

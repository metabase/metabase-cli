import { FEATURE_RULES, type FeatureGap, type FeatureName, type FeatureRule } from "./features";
import {
  missingTokenFeatureMessage,
  type RequirementFailure,
  versionTooOldMessage,
} from "./preflight-error";
import { featureGap, type ServerProfile } from "./profile";
import { describeVersion } from "./tag";

// A feature a call needs only because of an argument it was handed, with the request fields that
// argument travels in, as a server rejecting it names them.
export interface ParameterRequirement {
  readonly feature: FeatureName;
  readonly fields: readonly string[];
}

// What one call needs from the server: the features its arguments brought, then the method's own.
export interface CallRequirement {
  readonly parameters: readonly ParameterRequirement[];
  readonly method: readonly FeatureName[];
}

/** Every feature `call` needs, parameters first, since a parameter's floor sits above its method's. */
export function callFeatures(call: CallRequirement): FeatureName[] {
  return [...call.parameters.map((parameter) => parameter.feature), ...call.method];
}

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

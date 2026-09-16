import { z } from "zod";

import { FEATURE_RULES, type FeatureName, type FeatureRule } from "./features";
import { KNOWN_RANGE } from "./profile";

// What a set of features amounts to for a consumer that thinks in terms of one server floor and
// one premium feature rather than named switches.
export const CapabilitySummary = z.object({
  minVersion: z.number(),
  tokenFeature: z.string().optional(),
});
export type CapabilitySummary = z.infer<typeof CapabilitySummary>;

export function summarizeCapabilities(features: readonly FeatureName[]): CapabilitySummary {
  const rules: FeatureRule[] = features.map((feature) => FEATURE_RULES[feature]);
  const minVersion = Math.max(KNOWN_RANGE.min, ...rules.map((rule) => rule.since));
  const tokenFeatures = [
    ...new Set(
      rules.flatMap((rule) => (rule.tokenFeature === undefined ? [] : [rule.tokenFeature])),
    ),
  ];
  if (tokenFeatures.length > 1) {
    throw new Error(
      `a capability summary names one premium feature, got ${tokenFeatures.length}: ${tokenFeatures.join(", ")}`,
    );
  }
  const [tokenFeature] = tokenFeatures;
  return tokenFeature === undefined ? { minVersion } : { minVersion, tokenFeature };
}

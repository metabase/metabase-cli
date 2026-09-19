import { z } from "zod";

import type { TokenFeatures } from "../domain/session-properties";

// A rule holds on every major from `since` through `until` (both inclusive) on which the server
// also grants `tokenFeature`. Names describe the behaviour a consumer branches on, never the
// version it arrived in, so a rule reads the same after the majors around it leave the window.
// The table is the one place a server behaviour is pinned to a generation, so it also holds rules
// only the e2e suite branches on (`invalidMbqlIsBadRequest`, `collectionItemsTotalOnEmptyPage`,
// `transformTargetTableLinkedOnCreate`); a rule with no reader in `resources/` is not an orphan.
export interface FeatureRule {
  readonly since: number;
  readonly until?: number;
  readonly tokenFeature?: string;
}

export const FEATURE_RULES = {
  transforms: { since: 59 },
  transformJobActivation: { since: 61 },
  measures: { since: 59 },
  library: { since: 59, tokenFeature: "library" },
  remoteSync: { since: 60, tokenFeature: "remote_sync" },
  contentTranslation: { since: 58, tokenFeature: "content_translation" },
  contentVerification: { since: 58, tokenFeature: "content_verification" },
  transformTargetTableId: { since: 61 },
  transformTargetTableLinkedOnCreate: { since: 61, until: 61 },
  transformJobRunIdIsNumeric: { since: 64 },
  fieldDataSensitivity: { since: 64 },
  transformDagRuns: { since: 64 },
  unifiedTransformRuns: { since: 64 },
  libraryChildrenCarryType: { since: 62 },
  collectionItemsTotalOnEmptyPage: { since: 64 },
  invalidMbqlIsBadRequest: { since: 59 },
  boxplotDisplay: { since: 59 },
  nativeTableTemplateTag: { since: 59 },
  smartLinkMeasureModel: { since: 60 },
  dashboardSubscriptionFilters: { since: 58, tokenFeature: "dashboard_subscription_filters" },
  dependencyGraph: { since: 58, tokenFeature: "dependencies" },
  dependencyItemListings: { since: 59, tokenFeature: "dependencies" },
  tableListAccessFilters: { since: 59 },
  tableListTransformTargets: { since: 60 },
  tableUnusedFilter: { since: 58, tokenFeature: "dependencies" },
  bulkTableEdit: { since: 59 },
  erd: { since: 62, tokenFeature: "schema-viewer" },
} satisfies Record<string, FeatureRule>;

export type FeatureName = keyof typeof FEATURE_RULES;

export function isFeatureName(name: string): name is FeatureName {
  return Object.hasOwn(FEATURE_RULES, name);
}

export const FEATURE_NAMES: ReadonlyArray<FeatureName> =
  Object.keys(FEATURE_RULES).filter(isFeatureName);

export const Features = z.record(z.enum(FEATURE_NAMES), z.boolean());
export type Features = z.infer<typeof Features>;

export function evaluateFeatures(
  effectiveMajor: number,
  tokenFeatures: Readonly<TokenFeatures> | null,
): Features {
  const entries = FEATURE_NAMES.map((name) => [
    name,
    ruleHolds(FEATURE_RULES[name], effectiveMajor, tokenFeatures),
  ]);
  return Features.parse(Object.fromEntries(entries));
}

function ruleHolds(
  rule: FeatureRule,
  effectiveMajor: number,
  tokenFeatures: Readonly<TokenFeatures> | null,
): boolean {
  return ruleGap(rule, effectiveMajor, tokenFeatures) === null;
}

export interface VersionGap {
  readonly kind: "version";
}

export interface TokenGap {
  readonly kind: "token";
  readonly tokenFeature: string;
}

export type FeatureGap = VersionGap | TokenGap;

// The half of the rule the server fails, version first: an upgrade is the first step either way,
// and whether a token grants a route only matters once the route exists.
export function ruleGap(
  rule: FeatureRule,
  effectiveMajor: number,
  tokenFeatures: Readonly<TokenFeatures> | null,
): FeatureGap | null {
  if (effectiveMajor < rule.since) {
    return { kind: "version" };
  }
  if (rule.until !== undefined && effectiveMajor > rule.until) {
    return { kind: "version" };
  }
  if (rule.tokenFeature === undefined) {
    return null;
  }
  const granted = tokenFeatures !== null && tokenFeatures[rule.tokenFeature] === true;
  return granted ? null : { kind: "token", tokenFeature: rule.tokenFeature };
}

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
  remoteSyncExportPreflight: { since: 63, tokenFeature: "remote_sync" },
  contentTranslation: { since: 58, tokenFeature: "content_translation" },
  contentVerification: { since: 58, tokenFeature: "content_verification" },
  transformTargetTableId: { since: 61 },
  transformTargetTableLinkedOnCreate: { since: 61, until: 61 },
  transformJobRunIdIsNumeric: { since: 64 },
  transformCheckpointReset: { since: 60 },
  fieldDataSensitivity: { since: 64 },
  transformDagRuns: { since: 64 },
  unifiedTransformRuns: { since: 64 },
  transformTests: { since: 65, tokenFeature: "transforms-testing" },
  libraryChildrenCarryType: { since: 62 },
  collectionItemsTotalOnEmptyPage: { since: 64 },
  collectionItemsKebabCaseParams: { since: 64 },
  invalidMbqlIsBadRequest: { since: 59 },
  boxplotDisplay: { since: 59 },
  nativeTableTemplateTag: { since: 59 },
  smartLinkMeasureModel: { since: 60 },
  dashboardSubscriptionFilters: { since: 58, tokenFeature: "dashboard_subscription_filters" },
  dependencyGraph: { since: 58, tokenFeature: "dependencies" },
  dependencyItemListings: { since: 59, tokenFeature: "dependencies" },
  dependencyKebabCaseFilters: { since: 60 },
  tableListAccessFilters: { since: 59 },
  tableListTransformTargets: { since: 60 },
  tableUnusedFilter: { since: 58, tokenFeature: "dependencies" },
  tableDataLayerTiers: { since: 59 },
  bulkTableEdit: { since: 59 },
  erd: { since: 62, tokenFeature: "schema-viewer" },
  documentCopy: { since: 59 },
  transformInspector: { since: 60, tokenFeature: "transforms-python" },
  pythonLibrary: { since: 58, tokenFeature: "transforms-python" },
  pythonTestRun: { since: 60, tokenFeature: "transforms-python" },
  sourceReplacement: { since: 60, tokenFeature: "dependencies" },
  metricDefinitionQuery: { since: 60 },
  metricDimensionListing: { since: 64 },
  oauthFullAccessScope: { since: 63 },
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
  effectiveMajor: number | null,
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
  effectiveMajor: number | null,
  tokenFeatures: Readonly<TokenFeatures> | null,
): boolean {
  return ruleGap(rule, effectiveMajor, tokenFeatures) === null;
}

// `older` when the server predates the rule, `newer` when it is past the last major the rule
// holds on: a route later releases removed, or a shape they replaced.
export interface VersionGap {
  readonly kind: "version";
  readonly side: "older" | "newer";
}

export interface TokenGap {
  readonly kind: "token";
  readonly tokenFeature: string;
}

export type FeatureGap = VersionGap | TokenGap;

// The half of the rule the server fails, version first: an upgrade is the first step either way,
// and whether a token grants a route only matters once the route exists. A `null` major is a build
// whose tag names no release (a head image, a local jar); its version is not known to lack
// anything, so only the token half can refuse it.
export function ruleGap(
  rule: FeatureRule,
  effectiveMajor: number | null,
  tokenFeatures: Readonly<TokenFeatures> | null,
): FeatureGap | null {
  const gap = effectiveMajor === null ? null : versionGap(rule, effectiveMajor);
  if (gap !== null) {
    return gap;
  }
  if (rule.tokenFeature === undefined) {
    return null;
  }
  const granted = tokenFeatures !== null && tokenFeatures[rule.tokenFeature] === true;
  return granted ? null : { kind: "token", tokenFeature: rule.tokenFeature };
}

function versionGap(rule: FeatureRule, effectiveMajor: number): VersionGap | null {
  if (effectiveMajor < rule.since) {
    return { kind: "version", side: "older" };
  }
  if (rule.until !== undefined && effectiveMajor > rule.until) {
    return { kind: "version", side: "newer" };
  }
  return null;
}

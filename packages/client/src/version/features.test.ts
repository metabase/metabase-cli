import { describe, expect, it } from "vitest";

import {
  evaluateFeatures,
  FEATURE_NAMES,
  FEATURE_RULES,
  type FeatureName,
  type FeatureRule,
  ruleGap,
} from "./features";
import { KNOWN_RANGE } from "./known-range";

const RULES: ReadonlyArray<FeatureRule> = Object.values(FEATURE_RULES);

const ALL_TOKEN_FEATURES: Record<string, boolean> = Object.fromEntries(
  RULES.flatMap((rule) => (rule.tokenFeature === undefined ? [] : [[rule.tokenFeature, true]])),
);

function ruleFor(name: FeatureName): FeatureRule {
  return FEATURE_RULES[name];
}

// A token-gated rule may hold on every major in the window; the token, not the major, is what
// turns it off.
const VERSION_GATED_NAMES = FEATURE_NAMES.filter(
  (name) => ruleFor(name).tokenFeature === undefined,
);

// Every effective major `createServerProfile` can produce: the window itself plus the slot a
// newer or unparseable server lands in.
function effectiveMajors(): number[] {
  const majors: number[] = [];
  for (let major = KNOWN_RANGE.min; major <= KNOWN_RANGE.max + 1; major += 1) {
    majors.push(major);
  }
  return majors;
}

function outcomesAcrossWindow(name: FeatureName): Set<boolean> {
  return new Set(
    effectiveMajors().map((major) => evaluateFeatures(major, ALL_TOKEN_FEATURES)[name]),
  );
}

describe("FEATURE_RULES", () => {
  it.each(VERSION_GATED_NAMES)("%s is not constant across the known window", (name) => {
    expect(outcomesAcrossWindow(name)).toEqual(new Set([false, true]));
  });

  it("names every feature after a behaviour, never a version", () => {
    expect(FEATURE_NAMES.filter((name) => /v\d{2}/i.test(name))).toEqual([]);
  });
});

describe("evaluateFeatures", () => {
  it("turns a `since` rule on from that major and keeps it on above", () => {
    expect(evaluateFeatures(59, { remote_sync: true }).remoteSync).toBe(false);
    expect(evaluateFeatures(60, { remote_sync: true }).remoteSync).toBe(true);
    expect(evaluateFeatures(99, { remote_sync: true }).remoteSync).toBe(true);
  });

  it("holds a `tokenFeature` rule only when the server grants that feature", () => {
    expect(evaluateFeatures(61, null).remoteSync).toBe(false);
    expect(evaluateFeatures(61, { remote_sync: false }).remoteSync).toBe(false);
    expect(evaluateFeatures(61, { remote_sync: true }).remoteSync).toBe(true);
    expect(evaluateFeatures(58, { remote_sync: true }).remoteSync).toBe(false);
  });
});

describe("ruleGap", () => {
  const gated: FeatureRule = { since: 60, until: 62, tokenFeature: "remote_sync" };

  it("answers null when the major and the token both satisfy the rule", () => {
    expect(ruleGap(gated, 61, { remote_sync: true })).toBeNull();
  });

  it("names the version below `since` before it looks at the token", () => {
    expect(ruleGap(gated, 59, null)).toEqual({ kind: "version" });
    expect(ruleGap(gated, 59, { remote_sync: true })).toEqual({ kind: "version" });
  });

  it("names the version past `until`", () => {
    expect(ruleGap(gated, 63, { remote_sync: true })).toEqual({ kind: "version" });
  });

  it("names the token the server does not grant once the major fits", () => {
    expect(ruleGap(gated, 61, null)).toEqual({ kind: "token", tokenFeature: "remote_sync" });
    expect(ruleGap(gated, 61, { remote_sync: false })).toEqual({
      kind: "token",
      tokenFeature: "remote_sync",
    });
  });

  it("never names a token for a rule that has none", () => {
    expect(ruleGap({ since: 59 }, 61, null)).toBeNull();
  });
});

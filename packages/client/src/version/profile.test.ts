import { describe, expect, it } from "vitest";

import { evaluateFeatures } from "./features";
import type { ServerInfo } from "./probe";
import { KNOWN_RANGE } from "./known-range";
import { createServerProfile, featureGap } from "./profile";
import { editionFromTag } from "./tag";

const HEAD_SLOT = KNOWN_RANGE.max + 1;

function released(tag: string, major: number, tokenFeatures: ServerInfo["tokenFeatures"]) {
  return {
    version: { tag, major, patch: 2 },
    edition: editionFromTag(tag),
    date: "2026-05-19",
    hash: "0c64e27",
    tokenFeatures,
  } satisfies ServerInfo;
}

describe("createServerProfile", () => {
  it("keeps a major inside the window as supported, evaluated at its own major", () => {
    const info = released("v0.61.2", 61, { library: false });
    expect(createServerProfile(info)).toEqual({
      version: { tag: "v0.61.2", major: 61, patch: 2 },
      buildDate: "2026-05-19",
      hash: "0c64e27",
      edition: "oss",
      tokenFeatures: { library: false },
      features: evaluateFeatures(61, { library: false }),
      skew: "supported",
    });
  });

  it("reads a major above the window as the head slot and reports newer-than-known", () => {
    const info = released(`v1.${HEAD_SLOT + 5}.2`, HEAD_SLOT + 5, { library: true });
    expect(createServerProfile(info)).toEqual({
      version: { tag: `v1.${HEAD_SLOT + 5}.2`, major: HEAD_SLOT + 5, patch: 2 },
      buildDate: "2026-05-19",
      hash: "0c64e27",
      edition: "ee",
      tokenFeatures: { library: true },
      features: evaluateFeatures(HEAD_SLOT, { library: true }),
      skew: "newer-than-known",
    });
  });

  it("reads an unparseable tag as the head slot and reports unknown", () => {
    const info: ServerInfo = {
      version: null,
      edition: null,
      date: "2026-09-16",
      hash: "548573f",
      tokenFeatures: { library: false },
    };
    expect(createServerProfile(info)).toEqual({
      version: null,
      buildDate: "2026-09-16",
      hash: "548573f",
      edition: "oss",
      tokenFeatures: { library: false },
      features: evaluateFeatures(HEAD_SLOT, { library: false }),
      skew: "unknown",
    });
  });

  it("keeps a major below the window at its real major and reports older-than-known", () => {
    const info = released("v0.57.2", 57, null);
    expect(createServerProfile(info)).toEqual({
      version: { tag: "v0.57.2", major: 57, patch: 2 },
      buildDate: "2026-05-19",
      hash: "0c64e27",
      edition: "oss",
      tokenFeatures: null,
      features: evaluateFeatures(57, null),
      skew: "older-than-known",
    });
  });

  it("takes the edition from the tag even when no premium feature is granted", () => {
    expect(createServerProfile(released("v1.61.2", 61, null)).edition).toBe("ee");
  });

  it("takes the edition from a snapshot tag, which stamps one without a usable version", () => {
    const info: ServerInfo = {
      version: null,
      edition: "ee",
      date: null,
      hash: null,
      tokenFeatures: { library: false },
    };
    expect(createServerProfile(info).edition).toBe("ee");
  });

  it("takes the edition from a granted premium feature when the tag says nothing", () => {
    const info: ServerInfo = {
      version: null,
      edition: null,
      date: null,
      hash: null,
      tokenFeatures: { library: true, remote_sync: false },
    };
    expect(createServerProfile(info).edition).toBe("ee");
  });

  it("carries a probe without date, hash or token features as nulls", () => {
    const info: ServerInfo = {
      version: null,
      edition: null,
      date: null,
      hash: null,
      tokenFeatures: null,
    };
    expect(createServerProfile(info)).toEqual({
      version: null,
      buildDate: null,
      hash: null,
      edition: "oss",
      tokenFeatures: null,
      features: evaluateFeatures(HEAD_SLOT, null),
      skew: "unknown",
    });
  });
});

describe("featureGap", () => {
  it("agrees with the profile's own feature switch", () => {
    const profile = createServerProfile(released("v1.60.2", 60, { library: true }));
    expect(profile.features.library).toBe(true);
    expect(featureGap(profile, "library")).toBeNull();
    expect(profile.features.remoteSync).toBe(false);
    expect(featureGap(profile, "remoteSync")).toEqual({
      kind: "token",
      tokenFeature: "remote_sync",
    });
  });

  it("names the version on a major below the rule's first", () => {
    const profile = createServerProfile(released("v0.58.2", 58, null));
    expect(featureGap(profile, "transforms")).toEqual({ kind: "version" });
  });

  it("places an unparseable tag at the head slot, so only a token can be missing", () => {
    const info: ServerInfo = {
      version: null,
      edition: null,
      date: null,
      hash: null,
      tokenFeatures: null,
    };
    const profile = createServerProfile(info);
    expect(featureGap(profile, "transformJobRunIdIsNumeric")).toBeNull();
    expect(featureGap(profile, "library")).toEqual({ kind: "token", tokenFeature: "library" });
  });
});

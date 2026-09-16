import { describe, expect, it } from "vitest";

import type { ServerInfo } from "./probe";
import { createServerProfile } from "./profile";
import { checkFeatures, checkRequirements } from "./requirement-check";

function profileOf(tag: string, major: number, tokenFeatures: ServerInfo["tokenFeatures"]) {
  return createServerProfile({
    version: { tag, major, patch: 0 },
    date: null,
    hash: null,
    tokenFeatures,
  });
}

describe("checkRequirements", () => {
  it("answers null when the profile grants every feature the method needs", () => {
    expect(checkRequirements("transform.get", profileOf("v0.60.4", 60, null))).toBeNull();
  });

  it("answers null for a method that needs nothing, whatever the server", () => {
    expect(checkRequirements("card.list", profileOf("v0.57.0", 57, null))).toBeNull();
  });

  it("names the rule's floor and the server's tag for a version gate", () => {
    expect(checkRequirements("measure.list", profileOf("v0.58.0", 58, null))).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "measures",
      since: 59,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
  });

  it("names the premium feature for a token gate", () => {
    expect(checkRequirements("gitSync.branches", profileOf("v1.60.4", 60, null))).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
      feature: "remoteSync",
      since: 60,
      tokenFeature: "remote_sync",
      serverVersion: "v1.60.4",
    });
  });

  it("reports the version before the token when a gated rule fails both", () => {
    expect(checkRequirements("library.get", profileOf("v0.58.0", 58, null))).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "library",
      since: 59,
      tokenFeature: "library",
      serverVersion: "v0.58.0",
    });
  });

  it("reports the first missing feature of a method that needs several", () => {
    expect(checkRequirements("transformJob.setActive", profileOf("v0.60.4", 60, null))).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v61+ (this server is v0.60.4). Upgrade Metabase to use it.",
      feature: "transformJobActivation",
      since: 61,
      tokenFeature: null,
      serverVersion: "v0.60.4",
    });
  });

  it("names the strictest floor of a method that needs several, not the first one the server clears", () => {
    expect(checkRequirements("transformJob.setActive", profileOf("v0.58.0", 58, null))).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v61+ (this server is v0.58.0). Upgrade Metabase to use it.",
      feature: "transformJobActivation",
      since: 61,
      tokenFeature: null,
      serverVersion: "v0.58.0",
    });
  });

  it("places an unparseable tag past the newest known major, so only a token can refuse it", () => {
    const head = createServerProfile({
      version: null,
      date: "2026-09-16",
      hash: "548573f",
      tokenFeatures: { remote_sync: false },
    });
    expect(checkRequirements("transformJob.setActive", head)).toBeNull();
    expect(checkRequirements("gitSync.branches", head)).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
      feature: "remoteSync",
      since: 60,
      tokenFeature: "remote_sync",
      serverVersion: null,
    });
  });
});

describe("checkFeatures", () => {
  it("answers null for an empty list, whatever the server", () => {
    expect(checkFeatures([], profileOf("v0.57.0", 57, null))).toBeNull();
  });

  it("reports the first feature in the list the profile lacks", () => {
    expect(checkFeatures(["measures", "library"], profileOf("v0.59.0", 59, null))).toEqual({
      reason: "missing-token-feature",
      detail: "This operation requires the 'library' premium feature (not enabled on this server).",
      feature: "library",
      since: 59,
      tokenFeature: "library",
      serverVersion: "v0.59.0",
    });
  });
});

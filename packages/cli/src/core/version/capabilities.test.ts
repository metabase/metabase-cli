import { describe, expect, it } from "vitest";

import type { ServerInfo } from "./probe";

import {
  BASELINE_CAPABILITIES,
  checkCapabilities,
  mergeCapabilities,
  type Capabilities,
} from "./capabilities";

interface InfoOverrides {
  major?: number | null;
  tokenFeatures?: ServerInfo["tokenFeatures"];
}

function infoFor(overrides: InfoOverrides = {}): ServerInfo {
  if (overrides.major === null) {
    return { version: null, tokenFeatures: overrides.tokenFeatures ?? null };
  }
  const major = overrides.major ?? 58;
  return {
    version: { tag: `v0.${major}.0`, major, patch: 0 },
    tokenFeatures: overrides.tokenFeatures ?? null,
  };
}

describe("mergeCapabilities", () => {
  it("returns BASELINE_CAPABILITIES when overrides are undefined", () => {
    expect(mergeCapabilities()).toBe(BASELINE_CAPABILITIES);
  });

  it("overlays minVersion onto baseline", () => {
    expect(mergeCapabilities({ minVersion: 60 })).toEqual({ minVersion: 60 });
  });

  it("overlays tokenFeature onto baseline", () => {
    expect(mergeCapabilities({ tokenFeature: "transforms" })).toEqual({
      minVersion: 58,
      tokenFeature: "transforms",
    });
  });

  it("overlays both fields at once", () => {
    expect(mergeCapabilities({ minVersion: 60, tokenFeature: "scim" })).toEqual({
      minVersion: 60,
      tokenFeature: "scim",
    });
  });
});

describe("checkCapabilities", () => {
  it("returns null when the server matches baseline (major 58)", () => {
    expect(checkCapabilities(infoFor({ major: 58 }), BASELINE_CAPABILITIES)).toBeNull();
  });

  it("returns null when major equals minVersion exactly", () => {
    const required: Capabilities = { minVersion: 58 };
    expect(checkCapabilities(infoFor({ major: 58 }), required)).toBeNull();
  });

  it("returns null when major exceeds minVersion (purely numeric, no patch axis)", () => {
    const required: Capabilities = { minVersion: 99 };
    expect(checkCapabilities(infoFor({ major: 100 }), required)).toBeNull();
  });

  it("returns version-too-old when major is below minVersion", () => {
    const required: Capabilities = { minVersion: 60 };
    expect(checkCapabilities(infoFor({ major: 58 }), required)).toEqual({
      reason: "version-too-old",
      detail:
        "This command requires Metabase v60+ (this server is v0.58.0). Upgrade Metabase or pin mb-cli to an older release.",
    });
  });

  it("returns missing-token-feature when the required feature is absent from token-features", () => {
    const required: Capabilities = { minVersion: 58, tokenFeature: "transforms" };
    expect(
      checkCapabilities(
        infoFor({ major: 58, tokenFeatures: { transforms: false, embedding: true } }),
        required,
      ),
    ).toEqual({
      reason: "missing-token-feature",
      detail:
        "This command requires the 'transforms' premium feature (not enabled on this server).",
    });
  });

  it("returns null when the required tokenFeature is enabled", () => {
    const required: Capabilities = { minVersion: 58, tokenFeature: "transforms" };
    expect(
      checkCapabilities(infoFor({ major: 58, tokenFeatures: { transforms: true } }), required),
    ).toBeNull();
  });

  it("returns unknown-version when the probe failed to identify the server", () => {
    const required: Capabilities = { minVersion: 60 };
    expect(checkCapabilities(infoFor({ major: null }), required)).toEqual({
      reason: "unknown-version",
      detail:
        "Could not detect Metabase server version. Proceeding without preflight check; failures may produce confusing errors.",
    });
  });
});

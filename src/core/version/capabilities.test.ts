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
  build?: "oss" | "ee";
  edition?: ServerInfo["edition"];
  tokenFeatures?: ServerInfo["tokenFeatures"];
}

function infoFor(overrides: InfoOverrides = {}): ServerInfo {
  if (overrides.major === null) {
    return { version: null, edition: null, tokenFeatures: overrides.tokenFeatures ?? null };
  }
  const major = overrides.major ?? 58;
  const build = overrides.build ?? "oss";
  return {
    version: { tag: `v${build === "ee" ? "1" : "0"}.${major}.0`, build, major, patch: 0 },
    edition: overrides.edition ?? (build === "ee" ? "enterprise" : "oss"),
    tokenFeatures: overrides.tokenFeatures ?? null,
  };
}

describe("mergeCapabilities", () => {
  it("returns BASELINE_CAPABILITIES when overrides are undefined", () => {
    expect(mergeCapabilities()).toBe(BASELINE_CAPABILITIES);
  });

  it("overlays minVersion onto baseline", () => {
    expect(mergeCapabilities({ minVersion: 60 })).toEqual({
      minVersion: 60,
      edition: "oss",
    });
  });

  it("overlays edition onto baseline", () => {
    expect(mergeCapabilities({ edition: "pro" })).toEqual({
      minVersion: 58,
      edition: "pro",
    });
  });

  it("overlays tokenFeature onto baseline", () => {
    expect(mergeCapabilities({ tokenFeature: "transforms" })).toEqual({
      minVersion: 58,
      edition: "oss",
      tokenFeature: "transforms",
    });
  });

  it("overlays all three fields at once", () => {
    expect(
      mergeCapabilities({ minVersion: 60, edition: "enterprise", tokenFeature: "scim" }),
    ).toEqual({
      minVersion: 60,
      edition: "enterprise",
      tokenFeature: "scim",
    });
  });
});

describe("checkCapabilities", () => {
  it("returns null when the server matches baseline (major 58, oss)", () => {
    expect(
      checkCapabilities(infoFor({ major: 58, build: "oss" }), BASELINE_CAPABILITIES),
    ).toBeNull();
  });

  it("returns null when major equals minVersion exactly", () => {
    const required: Capabilities = { minVersion: 58, edition: "oss" };
    expect(checkCapabilities(infoFor({ major: 58 }), required)).toBeNull();
  });

  it("returns null when major exceeds minVersion (purely numeric, no patch axis)", () => {
    const required: Capabilities = { minVersion: 99, edition: "oss" };
    expect(checkCapabilities(infoFor({ major: 100 }), required)).toBeNull();
  });

  it("returns version-too-old when major is below minVersion, with the OSS upgrade hint", () => {
    const required: Capabilities = { minVersion: 60, edition: "oss" };
    expect(checkCapabilities(infoFor({ major: 58, build: "oss" }), required)).toEqual({
      reason: "version-too-old",
      detail:
        "This command requires Metabase v0.60+ (this server is v0.58.0). Upgrade Metabase or pin mb-cli to an older release.",
    });
  });

  it("returns version-too-old with the EE upgrade hint when the actual build is ee", () => {
    const required: Capabilities = { minVersion: 60, edition: "oss" };
    expect(checkCapabilities(infoFor({ major: 58, build: "ee" }), required)).toEqual({
      reason: "version-too-old",
      detail:
        "This command requires Metabase v1.60+ (this server is v1.58.0). Upgrade Metabase or pin mb-cli to an older release.",
    });
  });

  it("returns null when required edition pro is satisfied by actual pro", () => {
    const required: Capabilities = { minVersion: 58, edition: "pro" };
    expect(
      checkCapabilities(infoFor({ major: 58, build: "ee", edition: "pro" }), required),
    ).toBeNull();
  });

  it("returns null when required edition pro is satisfied by actual enterprise", () => {
    const required: Capabilities = { minVersion: 58, edition: "pro" };
    expect(
      checkCapabilities(infoFor({ major: 58, build: "ee", edition: "enterprise" }), required),
    ).toBeNull();
  });

  it("returns edition-mismatch when required pro and actual oss", () => {
    const required: Capabilities = { minVersion: 58, edition: "pro" };
    expect(checkCapabilities(infoFor({ major: 58, build: "oss" }), required)).toEqual({
      reason: "edition-mismatch",
      detail:
        "This command requires Metabase pro (this server is oss). Upgrade your Metabase edition.",
    });
  });

  it("returns missing-token-feature when required feature is absent from token-features", () => {
    const required: Capabilities = { minVersion: 58, edition: "pro", tokenFeature: "transforms" };
    expect(
      checkCapabilities(
        infoFor({
          major: 58,
          build: "ee",
          edition: "pro",
          tokenFeatures: { transforms: false, embedding: true },
        }),
        required,
      ),
    ).toEqual({
      reason: "missing-token-feature",
      detail:
        "This command requires the 'transforms' premium feature (not enabled on this server).",
    });
  });

  it("returns null when required tokenFeature is enabled", () => {
    const required: Capabilities = { minVersion: 58, edition: "pro", tokenFeature: "transforms" };
    expect(
      checkCapabilities(
        infoFor({
          major: 58,
          build: "ee",
          edition: "pro",
          tokenFeatures: { transforms: true },
        }),
        required,
      ),
    ).toBeNull();
  });

  it("returns unknown-version when the probe failed to identify the server", () => {
    const required: Capabilities = { minVersion: 60, edition: "enterprise" };
    expect(checkCapabilities(infoFor({ major: null }), required)).toEqual({
      reason: "unknown-version",
      detail:
        "Could not detect Metabase server version. Proceeding without preflight check; failures may produce confusing errors.",
    });
  });
});

import { describe, expect, it } from "vitest";

import { deriveEdition } from "./edition";

describe("deriveEdition", () => {
  it("returns oss when the build is oss regardless of token-features", () => {
    expect(deriveEdition("oss", { advanced_permissions: true })).toBe("oss");
  });

  it("returns oss when an EE build has no token-features at all", () => {
    expect(deriveEdition("ee", undefined)).toBe("oss");
  });

  it("returns oss when an EE build has all token-features false", () => {
    expect(
      deriveEdition("ee", {
        advanced_permissions: false,
        transforms: false,
        embedding: false,
      }),
    ).toBe("oss");
  });

  it("returns pro when an EE build enables only pro-tier features", () => {
    expect(
      deriveEdition("ee", {
        embedding: true,
        embedding_sdk: true,
        serialization: true,
        official_collections: true,
      }),
    ).toBe("pro");
  });

  it("returns enterprise when an EE build enables an enterprise-tier feature", () => {
    expect(
      deriveEdition("ee", {
        embedding: true,
        audit_app: true,
      }),
    ).toBe("enterprise");
  });

  it("returns enterprise when only enterprise-tier features are set", () => {
    expect(
      deriveEdition("ee", {
        whitelabel: true,
        sso_saml: true,
      }),
    ).toBe("enterprise");
  });
});

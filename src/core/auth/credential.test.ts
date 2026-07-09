import { describe, expect, it } from "vitest";

import {
  type ApiKeyCredential,
  type OAuthCredential,
  credentialAuthHeader,
  credentialSecrets,
  expiresAtFromNow,
  isOAuthExpired,
} from "./credential";

const API_KEY: ApiKeyCredential = { kind: "apiKey", apiKey: "mb_secret" };

function oauth(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    kind: "oauth",
    accessToken: "access-tok",
    refreshToken: "refresh-tok",
    expiresAt: "2026-01-01T00:00:00.000Z",
    clientId: "client-123",
    scope: "mb:full",
    ...overrides,
  };
}

describe("credentialAuthHeader", () => {
  it("uses the x-api-key header for an API key credential", () => {
    expect(credentialAuthHeader(API_KEY)).toEqual({ name: "x-api-key", value: "mb_secret" });
  });

  it("uses an Authorization Bearer header for an OAuth credential", () => {
    expect(credentialAuthHeader(oauth())).toEqual({
      name: "authorization",
      value: "Bearer access-tok",
    });
  });
});

describe("credentialSecrets", () => {
  it("returns the API key as the only secret", () => {
    expect(credentialSecrets(API_KEY)).toEqual(["mb_secret"]);
  });

  it("returns both OAuth tokens as secrets to redact", () => {
    expect(credentialSecrets(oauth())).toEqual(["access-tok", "refresh-tok"]);
  });
});

describe("isOAuthExpired", () => {
  const expiresAt = "2026-06-08T12:00:00.000Z";
  const expiryMs = Date.parse(expiresAt);

  it("is not expired well before the expiry", () => {
    expect(isOAuthExpired(oauth({ expiresAt }), expiryMs - 5 * 60_000)).toBe(false);
  });

  it("treats the token as expired within the 60s skew window", () => {
    expect(isOAuthExpired(oauth({ expiresAt }), expiryMs - 30_000)).toBe(true);
  });

  it("is expired at and after the expiry", () => {
    expect(isOAuthExpired(oauth({ expiresAt }), expiryMs)).toBe(true);
    expect(isOAuthExpired(oauth({ expiresAt }), expiryMs + 60_000)).toBe(true);
  });

  it("treats an unparseable expiry as expired (fail safe, never fail open)", () => {
    expect(isOAuthExpired(oauth({ expiresAt: "not-a-date" }), expiryMs)).toBe(true);
    expect(isOAuthExpired(oauth({ expiresAt: "" }), expiryMs)).toBe(true);
  });
});

describe("expiresAtFromNow", () => {
  it("adds the lifetime in seconds to now and renders an ISO timestamp", () => {
    const now = Date.parse("2026-06-08T12:00:00.000Z");
    expect(expiresAtFromNow(3600, now)).toBe("2026-06-08T13:00:00.000Z");
  });
});

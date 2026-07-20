import { afterEach, describe, expect, it, vi } from "vitest";

import { captureFetch, jsonResponse, type FetchScript } from "../http/fetch-capture";
import type { OAuthServerMetadata } from "../http/oauth";

import type { OAuthCredential } from "./credential";
import { refreshOAuthCredential } from "./oauth-session";

const CREDENTIAL: OAuthCredential = {
  kind: "oauth",
  accessToken: "acc-1",
  refreshToken: "ref-1",
  expiresAt: "2026-06-08T12:00:00.000Z",
  clientId: "client-1",
};

const METADATA: OAuthServerMetadata = {
  issuer: "https://m.example.com",
  authorization_endpoint: "https://m.example.com/oauth/authorize",
  token_endpoint: "https://m.example.com/oauth/token",
};

const NOW = Date.parse("2026-06-08T12:00:00.000Z");

function installFetch(script: FetchScript): void {
  vi.stubGlobal("fetch", captureFetch(script).fetch);
}

describe("refreshOAuthCredential", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts the rotated refresh token returned by the token endpoint", async () => {
    installFetch([
      jsonResponse(METADATA),
      jsonResponse({
        access_token: "acc-2",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "ref-2",
      }),
    ]);
    const refreshed = await refreshOAuthCredential("https://m.example.com", CREDENTIAL, NOW);
    expect(refreshed).toEqual({
      kind: "oauth",
      accessToken: "acc-2",
      refreshToken: "ref-2",
      expiresAt: "2026-06-08T13:00:00.000Z",
      clientId: "client-1",
    });
  });

  it("retains the current refresh token when the endpoint omits one", async () => {
    installFetch([
      jsonResponse(METADATA),
      jsonResponse({ access_token: "acc-2", token_type: "Bearer", expires_in: 3600 }),
    ]);
    const refreshed = await refreshOAuthCredential("https://m.example.com", CREDENTIAL, NOW);
    expect(refreshed).toEqual({
      kind: "oauth",
      accessToken: "acc-2",
      refreshToken: "ref-1",
      expiresAt: "2026-06-08T13:00:00.000Z",
      clientId: "client-1",
    });
  });
});

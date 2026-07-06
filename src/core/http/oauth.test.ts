import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { ConfigError, NetworkError } from "../errors";

import { USER_AGENT } from "./client";
import { HttpError } from "./errors";
import { captureFetch, jsonResponse, type FetchCapture, type FetchScript } from "./fetch-capture";
import {
  discoverMetadata,
  exchangeCode,
  OAUTH_SCOPE,
  OAUTH_UNSUPPORTED_MESSAGE,
  refreshTokens,
  revokeToken,
  tryDiscoverMetadata,
  WORKSPACE_MANAGER_SCOPE,
} from "./oauth";

function installFetch(script: FetchScript): FetchCapture {
  const capture = captureFetch(script);
  vi.stubGlobal("fetch", capture.fetch);
  return capture;
}

const TOKEN_ENDPOINT = "https://mb.example.com/oauth/token";

describe("oauth HTTP boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers authorization server metadata", async () => {
    const stub = installFetch([
      jsonResponse({
        issuer: "https://mb.example.com",
        authorization_endpoint: "https://mb.example.com/oauth/authorize",
        token_endpoint: TOKEN_ENDPOINT,
        registration_endpoint: "https://mb.example.com/oauth/register",
        scopes_supported: ["agent:sql:read", OAUTH_SCOPE],
      }),
    ]);
    const metadata = await discoverMetadata("https://mb.example.com");
    expect(metadata).toEqual({
      issuer: "https://mb.example.com",
      authorization_endpoint: "https://mb.example.com/oauth/authorize",
      token_endpoint: TOKEN_ENDPOINT,
      registration_endpoint: "https://mb.example.com/oauth/register",
      scopes_supported: ["agent:sql:read", OAUTH_SCOPE],
    });
    expect(stub.calls[0]?.url).toBe(
      "https://mb.example.com/.well-known/oauth-authorization-server",
    );
  });

  it("discovers metadata for an instance hosted under a subpath", async () => {
    const stub = installFetch([
      jsonResponse({
        issuer: "https://my.org.com/metabase",
        authorization_endpoint: "https://my.org.com/metabase/oauth/authorize",
        token_endpoint: "https://my.org.com/metabase/oauth/token",
      }),
    ]);
    const metadata = await discoverMetadata("https://my.org.com/metabase");
    expect(metadata).toEqual({
      issuer: "https://my.org.com/metabase",
      authorization_endpoint: "https://my.org.com/metabase/oauth/authorize",
      token_endpoint: "https://my.org.com/metabase/oauth/token",
    });
    expect(stub.calls[0]?.url).toBe(
      "https://my.org.com/metabase/.well-known/oauth-authorization-server",
    );
  });

  it("treats an agent-API-only OAuth server (no full-access scope advertised) as no OAuth support", async () => {
    installFetch([
      jsonResponse({
        issuer: "https://mb.example.com",
        authorization_endpoint: "https://mb.example.com/oauth/authorize",
        token_endpoint: TOKEN_ENDPOINT,
        scopes_supported: ["agent:sql:read", "agent:query"],
      }),
    ]);
    expect(await tryDiscoverMetadata("https://mb.example.com")).toBeNull();
  });

  it("treats a server that does not advertise the requested narrow scope as unsupported", async () => {
    installFetch([
      jsonResponse({
        issuer: "https://mb.example.com",
        authorization_endpoint: "https://mb.example.com/oauth/authorize",
        token_endpoint: TOKEN_ENDPOINT,
        scopes_supported: ["agent:sql:read", OAUTH_SCOPE],
      }),
    ]);
    expect(await tryDiscoverMetadata("https://mb.example.com", WORKSPACE_MANAGER_SCOPE)).toBeNull();
  });

  it("accepts a server advertising the requested narrow scope", async () => {
    installFetch([
      jsonResponse({
        issuer: "https://mb.example.com",
        authorization_endpoint: "https://mb.example.com/oauth/authorize",
        token_endpoint: TOKEN_ENDPOINT,
        scopes_supported: [OAUTH_SCOPE, WORKSPACE_MANAGER_SCOPE],
      }),
    ]);
    expect(await tryDiscoverMetadata("https://mb.example.com", WORKSPACE_MANAGER_SCOPE)).toEqual({
      issuer: "https://mb.example.com",
      authorization_endpoint: "https://mb.example.com/oauth/authorize",
      token_endpoint: TOKEN_ENDPOINT,
      scopes_supported: [OAUTH_SCOPE, WORKSPACE_MANAGER_SCOPE],
    });
  });

  it("accepts a discovery document that omits scopes_supported", async () => {
    installFetch([
      jsonResponse({
        issuer: "https://mb.example.com",
        authorization_endpoint: "https://mb.example.com/oauth/authorize",
        token_endpoint: TOKEN_ENDPOINT,
      }),
    ]);
    expect(await tryDiscoverMetadata("https://mb.example.com")).toEqual({
      issuer: "https://mb.example.com",
      authorization_endpoint: "https://mb.example.com/oauth/authorize",
      token_endpoint: TOKEN_ENDPOINT,
    });
  });

  it("treats the SPA shell served at the discovery path (pre-v60) as no OAuth support", async () => {
    installFetch([
      new Response("<!DOCTYPE html><html><body>Metabase</body></html>", {
        status: 200,
        headers: { "content-type": "text/html;charset=utf-8" },
      }),
    ]);
    expect(await tryDiscoverMetadata("https://mb.example.com")).toBeNull();
  });

  it("treats a 404 at the discovery path as no OAuth support", async () => {
    installFetch([new Response("Not found.", { status: 404 })]);
    expect(await tryDiscoverMetadata("https://mb.example.com")).toBeNull();
  });

  it("discoverMetadata names the required Metabase version when OAuth is unsupported", async () => {
    installFetch([new Response("Not found.", { status: 404 })]);
    const error = await discoverMetadata("https://mb.example.com").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(OAUTH_UNSUPPORTED_MESSAGE);
  });

  it("rejects a discovery document whose endpoints point at another origin", async () => {
    installFetch([
      jsonResponse({
        issuer: "https://mb.example.com",
        authorization_endpoint: "https://mb.example.com/oauth/authorize",
        // A tampered document trying to redirect the token exchange (code + PKCE verifier).
        token_endpoint: "https://attacker.example.com/oauth/token",
      }),
    ]);
    const error = await discoverMetadata("https://mb.example.com").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("token endpoint");
    expect(error.message).toContain("does not match the Metabase URL");
  });

  it("rejects a non-loopback http endpoint (no cleartext token transport)", async () => {
    installFetch([
      jsonResponse({
        issuer: "http://mb.example.com",
        authorization_endpoint: "http://mb.example.com/oauth/authorize",
        token_endpoint: "http://mb.example.com/oauth/token",
      }),
    ]);
    const error = await discoverMetadata("http://mb.example.com").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("must use https");
  });

  it("allows a loopback http instance for local development", async () => {
    installFetch([
      jsonResponse({
        issuer: "http://localhost:3000",
        authorization_endpoint: "http://localhost:3000/oauth/authorize",
        token_endpoint: "http://localhost:3000/oauth/token",
      }),
    ]);
    const metadata = await discoverMetadata("http://localhost:3000");
    expect(metadata).toEqual({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/oauth/token",
    });
  });

  it("exchanges an authorization code for tokens with a form-encoded body", async () => {
    const stub = installFetch([
      jsonResponse({
        access_token: "acc",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "ref",
        scope: "mb:full",
      }),
    ]);
    const tokens = await exchangeCode({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: "the-code",
      redirectUri: "http://127.0.0.1:5000/callback",
      clientId: "client-1",
      codeVerifier: "verifier-1",
    });
    expect(tokens).toEqual({
      access_token: "acc",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "ref",
      scope: "mb:full",
    });
    const call = stub.calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.body).toBe(
      new URLSearchParams({
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: "http://127.0.0.1:5000/callback",
        client_id: "client-1",
        code_verifier: "verifier-1",
      }).toString(),
    );
  });

  it("refreshes tokens with grant_type=refresh_token", async () => {
    const stub = installFetch([
      jsonResponse({ access_token: "acc2", token_type: "Bearer", refresh_token: "ref2" }),
    ]);
    const tokens = await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: "ref1",
      clientId: "client-1",
    });
    expect(tokens).toEqual({ access_token: "acc2", token_type: "Bearer", refresh_token: "ref2" });
    expect(stub.calls[0]?.body).toBe(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "ref1",
        client_id: "client-1",
      }).toString(),
    );
  });

  it("surfaces the OAuth error_description on a non-2xx token response", async () => {
    installFetch([
      jsonResponse({ error: "invalid_grant", error_description: "code is expired" }, 400),
    ]);
    const error = await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: "ref1",
      clientId: "client-1",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("OAuth token refresh failed (400): code is expired");
  });

  it("classifies a 5xx token response as a retryable HttpError, not a terminal ConfigError", async () => {
    installFetch([jsonResponse({ error: "temporarily_unavailable" }, 503)]);
    const error = await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: "ref1",
      clientId: "client-1",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(503);
    expect(error.isRetryable).toBe(true);
  });

  it("maps a transport failure to a host-aware NetworkError, not a bare fetch error", async () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
      code: "ECONNREFUSED",
    });
    const transportFailure = Object.assign(new TypeError("fetch failed"), { cause });
    installFetch([transportFailure]);
    const error = await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: "ref1",
      clientId: "client-1",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.message).toBe(
      "Could not reach Metabase: Connection refused by mb.example.com — is Metabase running and is the port correct?",
    );
  });

  it("stamps the shared user-agent on OAuth requests", async () => {
    const stub = installFetch([
      jsonResponse({ access_token: "acc", token_type: "Bearer", refresh_token: "ref" }),
    ]);
    await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: "ref1",
      clientId: "client-1",
    });
    expect(stub.calls[0]?.headers["user-agent"]).toBe(USER_AGENT);
  });

  it("revokes a token with the token and client_id in the form body", async () => {
    const stub = installFetch([new Response("", { status: 200 })]);
    await revokeToken({
      revocationEndpoint: "https://mb.example.com/oauth/revoke",
      token: "ref1",
      clientId: "client-1",
    });
    expect(stub.calls[0]?.body).toBe(
      new URLSearchParams({ token: "ref1", client_id: "client-1" }).toString(),
    );
  });
});

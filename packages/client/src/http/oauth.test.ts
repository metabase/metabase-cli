import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { ConfigError, NetworkError } from "../errors";

import { PROBE_PATH } from "../version/probe";

import { HttpError } from "./errors";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
  thrownBy,
  type FetchCapture,
  type FetchScript,
} from "../testing/fetch-capture";
import {
  discoverMetadata,
  discoverOAuth,
  exchangeCode,
  OAUTH_SCOPE,
  refreshTokens,
  revokeToken,
} from "./oauth";

function installFetch(script: FetchScript): FetchCapture {
  const capture = captureFetch(script);
  vi.stubGlobal("fetch", capture.fetch);
  return capture;
}

const TOKEN_ENDPOINT = "https://mb.example.com/oauth/token";
const BASE_URL = "https://mb.example.com";
const DISCOVERY_URL = `${BASE_URL}/.well-known/oauth-authorization-server`;
const PROPERTIES_URL = `${BASE_URL}${PROBE_PATH}`;
const HTML_CONTENT_TYPE = "text/html;charset=utf-8";
const AGENT_SCOPES = ["agent:sql:read", "agent:query"];

const DISCOVERY_DOCUMENT = {
  issuer: BASE_URL,
  authorization_endpoint: `${BASE_URL}/oauth/authorize`,
  token_endpoint: TOKEN_ENDPOINT,
};

const AGENT_ONLY_DOCUMENT = { ...DISCOVERY_DOCUMENT, scopes_supported: AGENT_SCOPES };

function spaShell(): Response {
  return new Response("<!DOCTYPE html><html><body>Metabase</body></html>", {
    status: 200,
    headers: { "content-type": HTML_CONTENT_TYPE },
  });
}

function propertiesFor(tag: string): Response {
  return jsonResponse({ version: { tag } });
}

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
    const metadata = await discoverMetadata("https://mb.example.com", TEST_USER_AGENT);
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
    const metadata = await discoverMetadata("https://my.org.com/metabase", TEST_USER_AGENT);
    expect(metadata).toEqual({
      issuer: "https://my.org.com/metabase",
      authorization_endpoint: "https://my.org.com/metabase/oauth/authorize",
      token_endpoint: "https://my.org.com/metabase/oauth/token",
    });
    expect(stub.calls[0]?.url).toBe(
      "https://my.org.com/metabase/.well-known/oauth-authorization-server",
    );
  });

  it("finds a discovery document that omits scopes_supported", async () => {
    installFetch([jsonResponse(DISCOVERY_DOCUMENT)]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({
      kind: "found",
      metadata: DISCOVERY_DOCUMENT,
    });
  });

  it("finds a document that advertises the full-access scope without asking for the version", async () => {
    const advertised = { ...DISCOVERY_DOCUMENT, scopes_supported: [...AGENT_SCOPES, OAUTH_SCOPE] };
    const stub = installFetch([jsonResponse(advertised)]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({
      kind: "found",
      metadata: advertised,
    });
    expect(stub.calls.map((call) => call.url)).toEqual([DISCOVERY_URL]);
  });

  it("answers the status of a 404 at the discovery path", async () => {
    installFetch([new Response("Not found.", { status: 404 })]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({ kind: "status", status: 404 });
  });

  it("answers the status of a 500 at the discovery path", async () => {
    installFetch([new Response("Server error", { status: 500 })]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({ kind: "status", status: 500 });
  });

  it("answers the content type of the SPA shell served at the discovery path", async () => {
    installFetch([spaShell()]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({
      kind: "notJson",
      contentType: HTML_CONTENT_TYPE,
    });
  });

  it("refuses agent-only scopes on a server too old to grant the full-access scope", async () => {
    const stub = installFetch([jsonResponse(AGENT_ONLY_DOCUMENT), propertiesFor("v0.61.2")]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({
      kind: "noFullAccessScope",
      offered: AGENT_SCOPES,
    });
    expect(stub.calls.map((call) => call.url)).toEqual([DISCOVERY_URL, PROPERTIES_URL]);
  });

  it("finds agent-only scopes on a server that grants the full-access scope unadvertised", async () => {
    installFetch([jsonResponse(AGENT_ONLY_DOCUMENT), propertiesFor("v0.64.1")]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({
      kind: "found",
      metadata: AGENT_ONLY_DOCUMENT,
    });
  });

  it("finds agent-only scopes on a server whose version tag carries no version", async () => {
    installFetch([jsonResponse(AGENT_ONLY_DOCUMENT), propertiesFor("vUNKNOWN")]);
    expect(await discoverOAuth(BASE_URL, TEST_USER_AGENT)).toEqual({
      kind: "found",
      metadata: AGENT_ONLY_DOCUMENT,
    });
  });

  it("discoverMetadata names the status the discovery path answered", async () => {
    installFetch([new Response("Not found.", { status: 404 })]);
    const error = await thrownBy(() => discoverMetadata(BASE_URL, TEST_USER_AGENT));
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "this Metabase offers no OAuth sign-in: its discovery document answered 404",
    );
  });

  it("discoverMetadata names the content type the discovery path answered", async () => {
    installFetch([spaShell()]);
    const error = await thrownBy(() => discoverMetadata(BASE_URL, TEST_USER_AGENT));
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "this Metabase offers no OAuth sign-in: its discovery document answered text/html;charset=utf-8, not JSON",
    );
  });

  it("discoverMetadata says a discovery answer without a content type is not JSON", async () => {
    installFetch([new Response(new TextEncoder().encode("<html></html>"), { status: 200 })]);
    const error = await thrownBy(() => discoverMetadata(BASE_URL, TEST_USER_AGENT));
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "this Metabase offers no OAuth sign-in: its discovery document answered no content type, not JSON",
    );
  });

  it("discoverMetadata says the server offers only narrower scopes", async () => {
    installFetch([jsonResponse(AGENT_ONLY_DOCUMENT), propertiesFor("v0.61.2")]);
    const error = await thrownBy(() => discoverMetadata(BASE_URL, TEST_USER_AGENT));
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "this Metabase offers OAuth only for 2 narrower scopes, not mb:full",
    );
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
    const error = await discoverMetadata("https://mb.example.com", TEST_USER_AGENT).catch(
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
    const error = await discoverMetadata("http://mb.example.com", TEST_USER_AGENT).catch(
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
    const metadata = await discoverMetadata("http://localhost:3000", TEST_USER_AGENT);
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
      userAgent: TEST_USER_AGENT,
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
      userAgent: TEST_USER_AGENT,
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
      userAgent: TEST_USER_AGENT,
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
      userAgent: TEST_USER_AGENT,
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
      userAgent: TEST_USER_AGENT,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.message).toBe(
      "Could not reach Metabase: Connection refused by mb.example.com — is Metabase running and is the port correct?",
    );
  });

  it("stamps the caller's user-agent on OAuth requests", async () => {
    const stub = installFetch([
      jsonResponse({ access_token: "acc", token_type: "Bearer", refresh_token: "ref" }),
    ]);
    await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: "ref1",
      clientId: "client-1",
      userAgent: TEST_USER_AGENT,
    });
    expect(stub.calls[0]?.headers["user-agent"]).toBe(TEST_USER_AGENT);
  });

  it("revokes a token with the token and client_id in the form body", async () => {
    const stub = installFetch([new Response("", { status: 200 })]);
    await revokeToken({
      revocationEndpoint: "https://mb.example.com/oauth/revoke",
      token: "ref1",
      clientId: "client-1",
      userAgent: TEST_USER_AGENT,
    });
    expect(stub.calls[0]?.body).toBe(
      new URLSearchParams({ token: "ref1", client_id: "client-1" }).toString(),
    );
  });
});

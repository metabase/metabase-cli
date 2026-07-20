import { createHash } from "node:crypto";

import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { ConfigError } from "../errors";
import type { CodeExchange, OAuthTokens } from "../http/oauth";

const hoisted = vi.hoisted<{
  tokens: OAuthTokens;
  metadata: OAuthServerMetadata;
  registerCalls: number;
  discoverCalls: number;
  exchange: CodeExchange | null;
}>(() => ({
  tokens: {
    access_token: "acc",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "ref",
  },
  metadata: {
    issuer: "https://mb.example.com",
    authorization_endpoint: "https://mb.example.com/oauth/authorize",
    token_endpoint: "https://mb.example.com/oauth/token",
    registration_endpoint: "https://mb.example.com/oauth/register",
  },
  registerCalls: 0,
  discoverCalls: 0,
  exchange: null,
}));

vi.mock("../http/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http/oauth")>();
  return {
    ...actual,
    discoverMetadata: async () => {
      hoisted.discoverCalls += 1;
      return hoisted.metadata;
    },
    registerClient: async () => {
      hoisted.registerCalls += 1;
      return { client_id: "client-xyz" };
    },
    exchangeCode: async (input: CodeExchange) => {
      hoisted.exchange = input;
      return hoisted.tokens;
    },
  };
});

import { OAuthServerMetadata } from "../http/oauth";
import { oauthLogin } from "./oauth-login";

const DEFAULT_TOKENS: OAuthTokens = {
  access_token: "acc",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "ref",
};

const DEFAULT_METADATA: OAuthServerMetadata = {
  issuer: "https://mb.example.com",
  authorization_endpoint: "https://mb.example.com/oauth/authorize",
  token_endpoint: "https://mb.example.com/oauth/token",
  registration_endpoint: "https://mb.example.com/oauth/register",
};

const NOW = Date.parse("2026-06-08T12:00:00.000Z");

// Simulates the browser: parses the authorize URL the CLI would open and hits the loopback redirect.
function browserDriver(): (url: string) => Promise<boolean> {
  return async (url: string): Promise<boolean> => {
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get("redirect_uri") ?? "";
    const state = parsed.searchParams.get("state") ?? "";
    await fetch(`${redirectUri}?code=test-code&state=${encodeURIComponent(state)}`);
    return true;
  };
}

// A hostile local request forges a wrong-state callback first; the genuine redirect follows.
function forgingThenGenuineBrowser(): (url: string) => Promise<boolean> {
  return async (url: string): Promise<boolean> => {
    const parsed = new URL(url);
    const redirectUri = parsed.searchParams.get("redirect_uri") ?? "";
    const realState = parsed.searchParams.get("state") ?? "";
    await fetch(`${redirectUri}?code=attacker-code&state=forged`);
    await fetch(`${redirectUri}?code=test-code&state=${encodeURIComponent(realState)}`);
    return true;
  };
}

describe("oauthLogin", () => {
  afterEach(() => {
    hoisted.tokens = { ...DEFAULT_TOKENS };
    hoisted.metadata = { ...DEFAULT_METADATA };
    hoisted.registerCalls = 0;
    hoisted.discoverCalls = 0;
    hoisted.exchange = null;
  });

  it("completes the PKCE loopback flow and assembles an OAuth credential", async () => {
    const announced: string[] = [];
    const credential = await oauthLogin(
      { baseUrl: "https://mb.example.com" },
      {
        openBrowser: browserDriver(),
        onAuthorizeUrl: (url) => announced.push(url),
        now: () => NOW,
      },
    );
    expect(credential).toEqual({
      kind: "oauth",
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: "2026-06-08T13:00:00.000Z",
      clientId: "client-xyz",
    });
    expect(announced).toHaveLength(1);
    expect(announced[0]).toContain("https://mb.example.com/oauth/authorize?");
    expect(announced[0]).toContain("code_challenge_method=S256");
    expect(announced[0]).toContain("client_id=client-xyz");

    // The token exchange must carry the callback's code, the exact redirect_uri that was
    // authorized, and the verifier whose S256 hash was sent as the code_challenge.
    const authorizeParams = new URL(announced[0] ?? "").searchParams;
    const redirectUri = authorizeParams.get("redirect_uri");
    assert(redirectUri !== null, "expected redirect_uri in the authorize URL");
    assert(hoisted.exchange !== null, "expected exchangeCode to be called");
    const { codeVerifier, ...exchangeRest } = hoisted.exchange;
    expect(exchangeRest).toEqual({
      tokenEndpoint: "https://mb.example.com/oauth/token",
      code: "test-code",
      redirectUri,
      clientId: "client-xyz",
    });
    expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(
      authorizeParams.get("code_challenge"),
    );
  });

  it("joins authorize params with & when the endpoint already carries a query", async () => {
    hoisted.metadata = {
      ...DEFAULT_METADATA,
      authorization_endpoint: "https://mb.example.com/oauth/authorize?tenant=t1",
    };
    const announced: string[] = [];
    await oauthLogin(
      { baseUrl: "https://mb.example.com" },
      {
        openBrowser: browserDriver(),
        onAuthorizeUrl: (url) => announced.push(url),
        now: () => NOW,
      },
    );
    expect(announced[0]).toContain("/oauth/authorize?tenant=t1&response_type=code");
  });

  it("uses caller-provided metadata without re-running discovery", async () => {
    const credential = await oauthLogin(
      {
        baseUrl: "https://mb.example.com",
        metadata: OAuthServerMetadata.parse(DEFAULT_METADATA),
      },
      { openBrowser: browserDriver(), onAuthorizeUrl: () => undefined, now: () => NOW },
    );
    expect(credential.clientId).toBe("client-xyz");
    expect(hoisted.discoverCalls).toBe(0);
  });

  it("ignores a forged wrong-state callback and completes on the genuine redirect", async () => {
    const credential = await oauthLogin(
      { baseUrl: "https://mb.example.com" },
      {
        openBrowser: forgingThenGenuineBrowser(),
        onAuthorizeUrl: () => undefined,
        now: () => NOW,
      },
    );
    expect(credential).toEqual({
      kind: "oauth",
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: "2026-06-08T13:00:00.000Z",
      clientId: "client-xyz",
    });
  });

  it("rejects when the token endpoint returns no refresh token", async () => {
    hoisted.tokens = {
      access_token: "acc",
      token_type: "Bearer",
      expires_in: 3600,
    };
    const error = await oauthLogin(
      { baseUrl: "https://mb.example.com" },
      { openBrowser: browserDriver(), onAuthorizeUrl: () => undefined, now: () => NOW },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("did not return a refresh token");
  });

  it("uses a provided client id and skips dynamic registration", async () => {
    const announced: string[] = [];
    const credential = await oauthLogin(
      { baseUrl: "https://mb.example.com", clientId: "preset-client" },
      {
        openBrowser: browserDriver(),
        onAuthorizeUrl: (url) => announced.push(url),
        now: () => NOW,
      },
    );
    expect(credential.clientId).toBe("preset-client");
    expect(hoisted.registerCalls).toBe(0);
    expect(announced[0]).toContain("client_id=preset-client");
  });

  it("errors when dynamic registration is disabled and no client id is given", async () => {
    const { registration_endpoint: _omit, ...withoutRegistration } = DEFAULT_METADATA;
    hoisted.metadata = withoutRegistration;
    const error = await oauthLogin(
      { baseUrl: "https://mb.example.com" },
      { openBrowser: browserDriver(), onAuthorizeUrl: () => undefined, now: () => NOW },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("dynamic client registration disabled");
    expect(hoisted.registerCalls).toBe(0);
  });
});

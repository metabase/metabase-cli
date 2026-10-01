import { createHash } from "node:crypto";

import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { ConfigError } from "../errors";
import type { ClientRegistration, CodeExchange, OAuthTokens } from "../http/oauth";

const hoisted = vi.hoisted<{
  tokens: OAuthTokens;
  metadata: OAuthServerMetadata;
  registerCalls: number;
  registration: ClientRegistration | null;
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
  registration: null,
  discoverCalls: 0,
  exchange: null,
}));

vi.mock("../http/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http/oauth")>();
  return {
    ...actual,
    discoverLoginMetadata: async () => {
      hoisted.discoverCalls += 1;
      return hoisted.metadata;
    },
    registerClient: async (input: ClientRegistration) => {
      hoisted.registerCalls += 1;
      hoisted.registration = input;
      return { client_id: "client-xyz" };
    },
    exchangeCode: async (input: CodeExchange) => {
      hoisted.exchange = input;
      return hoisted.tokens;
    },
  };
});

import { TEST_USER_AGENT } from "../testing/fetch-capture";
import { OAuthServerMetadata } from "../http/oauth";

import { oauthLogin, type OAuthLoginDeps, type PastedRedirectPrompt } from "./oauth-login";

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

const TEST_CLIENT_NAME = "Test OAuth Transport";

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

interface AuthorizeRedirect {
  redirectUri: string;
  state: string;
}

function authorizeRedirect(authorizeUrl: string): AuthorizeRedirect {
  const params = new URL(authorizeUrl).searchParams;
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  assert(redirectUri !== null && state !== null, "expected redirect_uri and state");
  return { redirectUri, state };
}

// A browser on another machine: nothing opens here, and the user pastes back where it landed.
interface PastingUser {
  announced: string[];
  prompts: PastedRedirectPrompt[];
}

function announcedRedirect(user: PastingUser): AuthorizeRedirect {
  const [url] = user.announced;
  assert(url !== undefined, "expected the authorize URL to be announced");
  return authorizeRedirect(url);
}

function onlyPrompt(user: PastingUser): PastedRedirectPrompt {
  const [prompt] = user.prompts;
  assert(prompt !== undefined, "expected the paste reader to be consulted");
  return prompt;
}

function noBrowserDeps(
  user: PastingUser,
  paste: (redirect: AuthorizeRedirect) => Promise<string>,
): OAuthLoginDeps {
  return {
    openBrowser: async () => false,
    onAuthorizeUrl: (url: string) => user.announced.push(url),
    readPastedRedirect: (prompt: PastedRedirectPrompt) => {
      user.prompts.push(prompt);
      return paste(announcedRedirect(user));
    },
    now: () => NOW,
  };
}

const LOGIN_INPUT = {
  baseUrl: "https://mb.example.com",
  userAgent: TEST_USER_AGENT,
  clientName: TEST_CLIENT_NAME,
};

describe("oauthLogin", () => {
  afterEach(() => {
    hoisted.tokens = { ...DEFAULT_TOKENS };
    hoisted.metadata = { ...DEFAULT_METADATA };
    hoisted.registerCalls = 0;
    hoisted.registration = null;
    hoisted.discoverCalls = 0;
    hoisted.exchange = null;
  });

  it("completes the PKCE loopback flow and assembles an OAuth credential", async () => {
    const announced: string[] = [];
    const credential = await oauthLogin(
      {
        baseUrl: "https://mb.example.com",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
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
      userAgent: TEST_USER_AGENT,
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
      {
        baseUrl: "https://mb.example.com",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
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
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
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
      {
        baseUrl: "https://mb.example.com",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
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
      {
        baseUrl: "https://mb.example.com",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
      { openBrowser: browserDriver(), onAuthorizeUrl: () => undefined, now: () => NOW },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("did not return a refresh token");
  });

  it("registers under the caller-supplied client name", async () => {
    const announced: string[] = [];
    await oauthLogin(
      {
        baseUrl: "https://mb.example.com",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
      {
        openBrowser: browserDriver(),
        onAuthorizeUrl: (url) => announced.push(url),
        now: () => NOW,
      },
    );
    const redirectUri = new URL(announced[0] ?? "").searchParams.get("redirect_uri");
    assert(redirectUri !== null, "expected redirect_uri in the authorize URL");
    expect(hoisted.registration).toEqual({
      registrationEndpoint: "https://mb.example.com/oauth/register",
      redirectUri,
      clientName: TEST_CLIENT_NAME,
      userAgent: TEST_USER_AGENT,
    });
  });

  it("uses a provided client id and skips dynamic registration", async () => {
    const announced: string[] = [];
    const credential = await oauthLogin(
      {
        baseUrl: "https://mb.example.com",
        clientId: "preset-client",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
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
      {
        baseUrl: "https://mb.example.com",
        userAgent: TEST_USER_AGENT,
        clientName: TEST_CLIENT_NAME,
      },
      { openBrowser: browserDriver(), onAuthorizeUrl: () => undefined, now: () => NOW },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("dynamic client registration disabled");
    expect(hoisted.registerCalls).toBe(0);
  });

  describe("without a browser", () => {
    it("exchanges the code from the pasted redirect against the authorized redirect_uri", async () => {
      const user: PastingUser = { announced: [], prompts: [] };
      const credential = await oauthLogin(
        LOGIN_INPUT,
        noBrowserDeps(
          user,
          async ({ redirectUri, state }) => `${redirectUri}?code=pasted-code&state=${state}`,
        ),
      );
      expect(credential.accessToken).toBe("acc");
      expect(hoisted.exchange).toEqual({
        tokenEndpoint: "https://mb.example.com/oauth/token",
        code: "pasted-code",
        redirectUri: announcedRedirect(user).redirectUri,
        clientId: "client-xyz",
        codeVerifier: expect.any(String),
        userAgent: TEST_USER_AGENT,
      });
    });

    it("completes on the loopback redirect and withdraws the paste prompt", async () => {
      const user: PastingUser = { announced: [], prompts: [] };
      const credential = await oauthLogin(
        LOGIN_INPUT,
        noBrowserDeps(user, async ({ redirectUri, state }) => {
          await fetch(`${redirectUri}?code=loopback-code&state=${state}`);
          return new Promise<string>(() => undefined);
        }),
      );
      expect(credential.accessToken).toBe("acc");
      expect(hoisted.exchange?.code).toBe("loopback-code");
      expect(user.prompts.map((prompt) => prompt.signal.aborted)).toEqual([true]);
    });

    it("hands the reader a validator that holds pastes to this login's state", async () => {
      const user: PastingUser = { announced: [], prompts: [] };
      await oauthLogin(
        LOGIN_INPUT,
        noBrowserDeps(
          user,
          async ({ redirectUri, state }) => `${redirectUri}?code=c&state=${state}`,
        ),
      );
      const prompt = onlyPrompt(user);
      const { redirectUri, state } = announcedRedirect(user);
      expect(prompt.validate(`${redirectUri}?code=c&state=${state}`)).toBeNull();
      expect(prompt.validate(`${redirectUri}?code=c&state=stale`)).toBe(
        "the pasted URL's state does not match this login; it belongs to a different or earlier attempt",
      );
      // A denial is a complete answer, not a bad paste: the reader returns it rather than re-asking.
      expect(prompt.validate(`${redirectUri}?error=access_denied&state=${state}`)).toBeNull();
    });

    it("rejects with the denial when the pasted redirect carries an error", async () => {
      const user: PastingUser = { announced: [], prompts: [] };
      const error = await oauthLogin(
        LOGIN_INPUT,
        noBrowserDeps(
          user,
          async ({ redirectUri, state }) => `${redirectUri}?error=access_denied&state=${state}`,
        ),
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe("authorization denied: access_denied");
      expect(hoisted.exchange).toBeNull();
    });

    it("rejects a pasted redirect the reader passed through unvalidated", async () => {
      const user: PastingUser = { announced: [], prompts: [] };
      const error = await oauthLogin(
        LOGIN_INPUT,
        noBrowserDeps(user, async ({ redirectUri }) => `${redirectUri}?code=c&state=forged`),
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe(
        "the pasted URL's state does not match this login; it belongs to a different or earlier attempt",
      );
      expect(hoisted.exchange).toBeNull();
    });

    it("times out while the paste prompt is open and withdraws it", async () => {
      const user: PastingUser = { announced: [], prompts: [] };
      const timeoutMs = 25;
      const error = await oauthLogin(
        { ...LOGIN_INPUT, timeoutMs },
        noBrowserDeps(user, () => new Promise<string>(() => undefined)),
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe(`timed out waiting for browser login after ${timeoutMs}ms`);
      expect(onlyPrompt(user).signal.aborted).toBe(true);
    });

    it("does not prompt for a paste when the browser opened", async () => {
      const prompts: PastedRedirectPrompt[] = [];
      await oauthLogin(LOGIN_INPUT, {
        openBrowser: browserDriver(),
        onAuthorizeUrl: () => undefined,
        readPastedRedirect: async (prompt) => {
          prompts.push(prompt);
          return new Promise<string>(() => undefined);
        },
        now: () => NOW,
      });
      expect(prompts).toEqual([]);
    });
  });
});

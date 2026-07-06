import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted<{
  store: Map<string, string>;
  controls: { broken: boolean };
  refreshError: Error | null;
  refreshUrls: string[];
}>(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
  refreshError: null,
  refreshUrls: [],
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("./auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

vi.mock("./auth/oauth-session", () => ({
  refreshOAuthCredential: async (
    url: string,
    credential: OAuthCredential,
  ): Promise<OAuthCredential> => {
    hoisted.refreshUrls.push(url);
    if (hoisted.refreshError !== null) {
      throw hoisted.refreshError;
    }
    return {
      ...credential,
      accessToken: "refreshed-access",
      refreshToken: "refreshed-refresh",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  },
  revokeOAuthCredential: async (): Promise<boolean> => true,
}));

import type { OAuthCredential } from "./auth/credential";
import {
  readProfileCredential,
  writeOAuthProfile,
  writeProbeFailure,
  writeProbeResult,
  writeProfile,
} from "./auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "./auth/temp-config-home";
import {
  createCredentialRefresher,
  explicitProfileName,
  resolveConfig,
  resolveProfileName,
} from "./config";
import { ConfigError } from "./errors";

const STORED_OAUTH: OAuthCredential = {
  kind: "oauth",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: "2000-01-01T00:00:00.000Z",
  clientId: "c1",
  scope: "mb:full",
};

const REFRESHED_OAUTH: OAuthCredential = {
  kind: "oauth",
  accessToken: "refreshed-access",
  refreshToken: "refreshed-refresh",
  expiresAt: "2099-01-01T00:00:00.000Z",
  clientId: "c1",
  scope: "mb:full",
};

function clearConfigEnv(): void {
  for (const name of ["URL", "API_KEY", "PROFILE"]) {
    delete process.env[`MB_${name}`];
    delete process.env[`METABASE_${name}`];
  }
}

describe("resolveConfig", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
    clearConfigEnv();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("prefers flags over environment and stored creds", async () => {
    process.env["MB_URL"] = "http://env";
    process.env["MB_API_KEY"] = "env-key";
    const config = await resolveConfig({
      url: "https://flag.example.com",
      apiKey: "flag-key",
    });
    expect(config).toEqual({
      url: "https://flag.example.com",
      credential: { kind: "apiKey", apiKey: "flag-key" },
      profile: "default",
      source: "flag",
    });
  });

  it("falls back to environment", async () => {
    process.env["MB_URL"] = "https://env.example.com/";
    process.env["MB_API_KEY"] = "env-key";
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://env.example.com",
      credential: { kind: "apiKey", apiKey: "env-key" },
      profile: "default",
      source: "env",
    });
  });

  it("falls back to stored credentials for the default profile", async () => {
    await writeProfile({
      url: "https://saved.example.com",
      apiKey: "saved-key",
    });
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://saved.example.com",
      credential: { kind: "apiKey", apiKey: "saved-key" },
      profile: "default",
      source: "stored",
    });
  });

  it("reads the named profile when --profile is passed", async () => {
    await writeProfile({ url: "https://default.example.com", apiKey: "default-key" });
    await writeProfile({ url: "https://staging.example.com", apiKey: "staging-key" }, "staging");
    const config = await resolveConfig({ profile: "staging" });
    expect(config).toEqual({
      url: "https://staging.example.com",
      credential: { kind: "apiKey", apiKey: "staging-key" },
      profile: "staging",
      source: "stored",
    });
  });

  it("reads the named profile when MB_PROFILE is set", async () => {
    await writeProfile({ url: "https://default.example.com", apiKey: "default-key" });
    await writeProfile({ url: "https://prod.example.com", apiKey: "prod-key" }, "prod");
    process.env["MB_PROFILE"] = "prod";
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://prod.example.com",
      credential: { kind: "apiKey", apiKey: "prod-key" },
      profile: "prod",
      source: "stored",
    });
  });

  it("flag profile beats MB_PROFILE env var", async () => {
    await writeProfile({ url: "https://staging.example.com", apiKey: "staging-key" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "prod-key" }, "prod");
    process.env["MB_PROFILE"] = "prod";
    const config = await resolveConfig({ profile: "staging" });
    expect(config).toEqual({
      url: "https://staging.example.com",
      credential: { kind: "apiKey", apiKey: "staging-key" },
      profile: "staging",
      source: "stored",
    });
  });

  it("composes flag-only url with stored apiKey (mixed source)", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" });
    const config = await resolveConfig({ url: "https://override.example.com" });
    expect(config).toEqual({
      url: "https://override.example.com",
      credential: { kind: "apiKey", apiKey: "saved-key" },
      profile: "default",
      source: "mixed",
    });
  });

  it("composes env-only apiKey with stored url (mixed source)", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" });
    process.env["MB_API_KEY"] = "env-key";
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://saved.example.com",
      credential: { kind: "apiKey", apiKey: "env-key" },
      profile: "default",
      source: "mixed",
    });
  });

  it("throws ConfigError for an unknown profile when nothing else is set", async () => {
    await writeProfile({ url: "https://default.example.com", apiKey: "default-key" });
    const error = await resolveConfig({ profile: "missing" }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain('Not authenticated for profile "missing"');
  });

  it("throws ConfigError when nothing is configured", async () => {
    const error = await resolveConfig({}).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("Not authenticated");
  });

  it("does not append the lastFailure hint when stored credentials are still usable", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" }, "still_works");
    await writeProbeFailure("still_works", {
      kind: "auth",
      reason: "Invalid or unauthorized API key",
    });
    const config = await resolveConfig({ profile: "still_works" });
    expect(config).toEqual({
      url: "https://saved.example.com",
      credential: { kind: "apiKey", apiKey: "saved-key" },
      profile: "still_works",
      source: "stored",
    });
  });

  it("appends the lastFailure hint when the keyring entry disappears under an existing failure record", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" }, "lost");
    await writeProbeFailure("lost", {
      kind: "auth",
      reason: "Invalid or unauthorized API key",
    });
    hoisted.store.delete("metabase-cli:profile:lost:apiKey");

    const error = await resolveConfig({ profile: "lost" }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain(
      'profile "lost" last verify failed: Invalid or unauthorized API key',
    );
    expect(error.message).toContain("Run `mb auth login --profile lost` to update the token.");
  });

  it("omits the lastFailure hint after a successful re-probe clears the failure", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" }, "recovers");
    await writeProbeFailure("recovers", {
      kind: "auth",
      reason: "old failure",
    });
    await writeProbeResult("recovers", {
      user: { id: 1, name: "Tester", isAdmin: true },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        tokenFeatures: null,
      },
    });
    hoisted.store.delete("metabase-cli:profile:recovers:apiKey");

    const error = await resolveConfig({ profile: "recovers" }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).not.toContain("last verify failed");
  });
});

describe("resolveProfileName", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["MB_PROFILE"];
    delete process.env["METABASE_PROFILE"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the flag value when provided", () => {
    process.env["MB_PROFILE"] = "env-profile";
    expect(resolveProfileName("flag-profile")).toBe("flag-profile");
  });

  it("falls back to MB_PROFILE when no flag", () => {
    process.env["MB_PROFILE"] = "env-profile";
    expect(resolveProfileName(undefined)).toBe("env-profile");
  });

  it("falls back to default when neither flag nor env is set", () => {
    expect(resolveProfileName(undefined)).toBe("default");
  });
});

describe("explicitProfileName", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["MB_PROFILE"];
    delete process.env["METABASE_PROFILE"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the flag value when provided", () => {
    process.env["MB_PROFILE"] = "env-profile";
    expect(explicitProfileName("flag-profile")).toBe("flag-profile");
  });

  it("returns MB_PROFILE when no flag", () => {
    process.env["MB_PROFILE"] = "env-profile";
    expect(explicitProfileName(undefined)).toBe("env-profile");
  });

  it("returns null when neither flag nor env is set", () => {
    expect(explicitProfileName(undefined)).toBeNull();
  });
});

describe("resolveConfig OAuth credentials", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.refreshUrls = [];
    home = setupTempConfigHome();
    clearConfigEnv();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("returns a stored OAuth credential that is still valid without refreshing", async () => {
    await writeOAuthProfile(
      "https://oauth.example.com",
      { ...STORED_OAUTH, expiresAt: "2099-01-01T00:00:00.000Z" },
      "oauthp",
    );
    const config = await resolveConfig({ profile: "oauthp" });
    expect(config).toEqual({
      url: "https://oauth.example.com",
      credential: { ...STORED_OAUTH, expiresAt: "2099-01-01T00:00:00.000Z" },
      profile: "oauthp",
      source: "stored",
    });
  });

  it("refuses to send a stored OAuth credential to a --url-overridden host", async () => {
    await writeOAuthProfile("https://oauth.example.com", STORED_OAUTH, "oauthp");
    const error = await resolveConfig({
      profile: "oauthp",
      url: "https://evil.example.com",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      'profile "oauthp" is a browser-login (OAuth) profile bound to https://oauth.example.com, ' +
        "but the request URL is https://evil.example.com. " +
        "Drop --url/MB_URL to use the profile's own URL, or run " +
        "`mb auth login --url https://evil.example.com` to authenticate there.",
    );
  });

  it("allows a --url that matches the OAuth issuer after normalization", async () => {
    const valid = { ...STORED_OAUTH, expiresAt: "2099-01-01T00:00:00.000Z" };
    await writeOAuthProfile("https://oauth.example.com", valid, "oauthp");
    const config = await resolveConfig({ profile: "oauthp", url: "https://oauth.example.com/" });
    expect(config).toEqual({
      url: "https://oauth.example.com",
      credential: valid,
      profile: "oauthp",
      source: "mixed",
    });
  });

  it("proactively refreshes and persists an expired stored OAuth credential", async () => {
    await writeOAuthProfile("https://oauth.example.com", STORED_OAUTH, "oauthp");
    const config = await resolveConfig({ profile: "oauthp" });
    expect(config).toEqual({
      url: "https://oauth.example.com",
      credential: REFRESHED_OAUTH,
      profile: "oauthp",
      source: "stored",
    });
    expect(await readProfileCredential("oauthp")).toEqual({
      url: "https://oauth.example.com",
      credential: REFRESHED_OAUTH,
    });
    // The refresh leg is pinned to the stored issuer the refresh token is bound to.
    expect(hoisted.refreshUrls).toEqual(["https://oauth.example.com"]);
  });

  it("falls back to the existing credential when a proactive refresh fails", async () => {
    await writeOAuthProfile("https://oauth.example.com", STORED_OAUTH, "oauthp");
    hoisted.refreshError = new Error("token endpoint unreachable");
    try {
      const config = await resolveConfig({ profile: "oauthp" });
      // Best-effort: the command still resolves with the (expired) stored credential rather than
      // throwing — the reactive 401-refresh will recover on the first request.
      expect(config).toEqual({
        url: "https://oauth.example.com",
        credential: STORED_OAUTH,
        profile: "oauthp",
        source: "stored",
      });
    } finally {
      hoisted.refreshError = null;
    }
  });

  it("createCredentialRefresher refreshes and persists the stored OAuth credential", async () => {
    await writeOAuthProfile("https://oauth.example.com", STORED_OAUTH, "oauthp");
    const refresh = createCredentialRefresher("oauthp");
    expect(await refresh()).toEqual(REFRESHED_OAUTH);
    expect(await readProfileCredential("oauthp")).toEqual({
      url: "https://oauth.example.com",
      credential: REFRESHED_OAUTH,
    });
    // The reactive refresher reads the stored profile, so the refresh leg targets its issuer —
    // never whatever URL the failing request was sent to.
    expect(hoisted.refreshUrls).toEqual(["https://oauth.example.com"]);
  });

  it("createCredentialRefresher adds a re-login hint when the server rejects the refresh", async () => {
    await writeOAuthProfile("https://oauth.example.com", STORED_OAUTH, "oauthp");
    hoisted.refreshError = new ConfigError("OAuth token refresh failed (400): invalid_grant");
    try {
      const refresh = createCredentialRefresher("oauthp");
      const error = await refresh().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigError);
      assert(error instanceof ConfigError, "expected ConfigError");
      expect(error.message).toBe(
        "OAuth token refresh failed (400): invalid_grant — run `mb auth login --profile oauthp` to log in again",
      );
    } finally {
      hoisted.refreshError = null;
    }
  });

  it("createCredentialRefresher returns null for an API key profile", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "keyp");
    const refresh = createCredentialRefresher("keyp");
    expect(await refresh()).toBeNull();
  });
});

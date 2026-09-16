import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseJson } from "@metabase/client/json";

import { type ProfileRecord, ProfilesFile } from "./profile-record";
import { configDir } from "../paths";
import { setupTempConfigHome, type TempConfigHome } from "./temp-config-home";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("./keyring-mock");
  return createKeyringMockModule(hoisted);
});

import * as storage from "./storage";

const {
  clearProfile,
  consumeKeychainResidualWarning,
  consumeKeyringDowngradeWarning,
  consumeLegacyStorageWarning,
  KEYCHAIN_RESIDUAL_NOTICE,
  keyringFallbackWarning,
  LEGACY_STORAGE_NOTICE,
  listProfileNames,
  listProfileRecords,
  profilesFilePath,
  readProfileCredential,
  readProfileRecord,
  writeOAuthProfile,
  writeProbeFailure,
  writeProbeResult,
  writeProfile,
} = storage;

import type { OAuthCredential } from "@metabase/client/auth/credential";
import type { FileLocation } from "./storage";

const OAUTH: OAuthCredential = {
  kind: "oauth",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: "2026-06-08T13:00:00.000Z",
  clientId: "client-1",
};

function defaultRecord(apiKey: string | null): ProfileRecord {
  return {
    name: "default",
    url: "https://m.example.com",
    apiKey,
    oauth: null,
    lastProbe: null,
    lastFailure: null,
  };
}

import { join } from "node:path";

function legacyCredentialsPath(): string {
  return join(configDir(), "credentials.json");
}

function legacyRejectionsPath(): string {
  return join(configDir(), "rejections.json");
}

const IS_WINDOWS = process.platform === "win32";
const PROBED_AT = "2026-03-04T05:06:07.000Z";
const FAILED_AT = "2026-03-04T06:00:00.000Z";

describe("profiles (keyring backend)", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("writeProfile stores the API key in the keyring and the URL on disk", async () => {
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location).toEqual({
      backend: "keyring",
      service: "metabase-cli",
      account: "profile:default:apiKey",
    });
    expect(hoisted.store.get("metabase-cli:profile:default:apiKey")).toBe("secret");

    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file).toEqual({
      profiles: [
        {
          name: "default",
          url: "https://m.example.com",
          apiKey: null,
          oauth: null,
          lastProbe: null,
          lastFailure: null,
        },
      ],
    });
  });

  it("readProfile returns the URL with the API key from the keyring", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: { kind: "apiKey", apiKey: "secret" },
    });
  });

  it("isolates named profiles", async () => {
    await writeProfile({ url: "https://default.example.com", apiKey: "default-key" });
    await writeProfile({ url: "https://prod.example.com", apiKey: "prod-key" }, "prod");

    expect(await readProfileCredential()).toEqual({
      url: "https://default.example.com",
      credential: { kind: "apiKey", apiKey: "default-key" },
    });
    expect(await readProfileCredential("prod")).toEqual({
      url: "https://prod.example.com",
      credential: { kind: "apiKey", apiKey: "prod-key" },
    });
  });

  it("preserves user add order (no sort) and overwrites existing entries in place", async () => {
    await writeProfile({ url: "https://1.example.com", apiKey: "k1" }, "zeta");
    await writeProfile({ url: "https://2.example.com", apiKey: "k2" }, "alpha");
    await writeProfile({ url: "https://2b.example.com", apiKey: "k2b" }, "alpha");
    expect(await listProfileNames()).toEqual(["zeta", "alpha"]);
    const alpha = await readProfileCredential("alpha");
    expect(alpha).toEqual({
      url: "https://2b.example.com",
      credential: { kind: "apiKey", apiKey: "k2b" },
    });
  });

  it("clearProfile removes the entry from JSON and the keyring", async () => {
    await writeProfile({ url: "https://a.example.com", apiKey: "a" }, "a");
    await writeProfile({ url: "https://b.example.com", apiKey: "b" }, "b");

    expect(await clearProfile("a")).toBe(true);
    expect(await readProfileCredential("a")).toBeNull();
    expect(hoisted.store.get("metabase-cli:profile:a:apiKey")).toBeUndefined();
    expect(await readProfileCredential("b")).toEqual({
      url: "https://b.example.com",
      credential: { kind: "apiKey", apiKey: "b" },
    });
  });

  it("clearProfile returns false when no entry matches the name", async () => {
    expect(await clearProfile("missing")).toBe(false);
  });

  it("deletes profiles.json when the last profile is gone", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "only");
    await clearProfile("only");
    expect(existsSync(profilesFilePath())).toBe(false);
  });

  it.skipIf(IS_WINDOWS)("writes profiles.json with 0600 perms", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "only");
    const mode = statSync(profilesFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("profiles (file fallback when keyring is broken)", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = true;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    hoisted.controls.broken = false;
    home.cleanup();
  });

  it.skipIf(IS_WINDOWS)("stores the API key inline in profiles.json with 0600 perms", async () => {
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location).toEqual({
      backend: "file",
      path: profilesFilePath(),
      account: "profile:default:apiKey",
      reason: "unavailable",
    });
    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file).toEqual({ profiles: [defaultRecord("secret")] });
    const mode = statSync(profilesFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("readProfile returns the inline API key when the keyring is broken", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: { kind: "apiKey", apiKey: "secret" },
    });
  });
});

describe("readProfileRecord and listProfileRecords", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("returns null when the profile does not exist", async () => {
    expect(await readProfileRecord("missing")).toBeNull();
  });

  it("returns the full record with lastProbe: null after a fresh write", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "staging");
    expect(await readProfileRecord("staging")).toEqual({
      name: "staging",
      url: "https://m.example.com",
      apiKey: null,
      oauth: null,
      lastProbe: null,
      lastFailure: null,
    });
  });

  it("lists records in user-add order", async () => {
    await writeProfile({ url: "https://1.example.com", apiKey: "k1" }, "zeta");
    await writeProfile({ url: "https://2.example.com", apiKey: "k2" }, "alpha");
    const records = await listProfileRecords();
    expect(records.map((entry) => entry.name)).toEqual(["zeta", "alpha"]);
  });
});

describe("writeProbeResult and writeProbeFailure", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(PROBED_AT));
  });

  afterEach(() => {
    vi.useRealTimers();
    home.cleanup();
  });

  const ALICE_PROBE = {
    at: PROBED_AT,
    version: { tag: "v0.58.7", major: 58, patch: 7 },
    date: null,
    hash: null,
    tokenFeatures: null,
    user: { id: 42, name: "Alice", isAdmin: true },
  };

  it("writeProbeResult populates lastProbe and clears lastFailure", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "p");
    await writeProbeFailure("p", { kind: "auth", reason: "bad" });
    const probe = await writeProbeResult("p", {
      user: { id: 42, name: "Alice", isAdmin: true },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        date: null,
        hash: null,
        tokenFeatures: null,
      },
    });
    expect(probe).toEqual(ALICE_PROBE);
    expect(await readProfileRecord("p")).toEqual({
      name: "p",
      url: "https://m.example.com",
      apiKey: null,
      oauth: null,
      lastProbe: ALICE_PROBE,
      lastFailure: null,
    });
  });

  it("writeProbeResult returns null and does not create a record when none exists", async () => {
    const result = await writeProbeResult("ghost", {
      user: { id: 1, name: "n", isAdmin: false },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        date: null,
        hash: null,
        tokenFeatures: null,
      },
    });
    expect(result).toBeNull();
    expect(await readProfileRecord("ghost")).toBeNull();
  });

  it("writeProbeFailure updates lastFailure but leaves apiKey/url/lastProbe untouched", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "p");
    await writeProbeResult("p", {
      user: { id: 42, name: "Alice", isAdmin: true },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        date: null,
        hash: null,
        tokenFeatures: null,
      },
    });
    vi.setSystemTime(new Date(FAILED_AT));

    const failure = await writeProbeFailure("p", {
      kind: "auth",
      reason: "Invalid or unauthorized API key",
    });

    expect(failure).toEqual({
      at: FAILED_AT,
      kind: "auth",
      reason: "Invalid or unauthorized API key",
    });
    expect(await readProfileRecord("p")).toEqual({
      name: "p",
      url: "https://m.example.com",
      apiKey: null,
      oauth: null,
      lastProbe: ALICE_PROBE,
      lastFailure: { at: FAILED_AT, kind: "auth", reason: "Invalid or unauthorized API key" },
    });
    expect(hoisted.store.get("metabase-cli:profile:p:apiKey")).toBe("k");
  });
});

describe("MB_CLI_DISABLE_KEYRING", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
    process.env["MB_CLI_DISABLE_KEYRING"] = "1";
  });

  afterEach(() => {
    home.cleanup();
  });

  it("forces file backend even when keyring is healthy", async () => {
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location).toEqual({
      backend: "file",
      path: profilesFilePath(),
      account: "profile:default:apiKey",
      reason: "disabled",
    });
    expect(hoisted.store.size).toBe(0);
    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file).toEqual({ profiles: [defaultRecord("secret")] });
  });

  it("treats values other than '1' as not-disabled", async () => {
    process.env["MB_CLI_DISABLE_KEYRING"] = "0";
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location).toEqual({
      backend: "keyring",
      service: "metabase-cli",
      account: "profile:default:apiKey",
    });
  });
});

describe("keyringFallbackWarning", () => {
  it("names the env var when the keyring was deliberately disabled", () => {
    const location: FileLocation = {
      backend: "file",
      path: "/tmp/profiles.json",
      account: "profile:default:apiKey",
      reason: "disabled",
    };
    expect(keyringFallbackWarning(location)).toBe(
      "warning: OS keychain disabled via MB_CLI_DISABLE_KEYRING; credentials stored as plaintext at /tmp/profiles.json",
    );
  });

  it("reports an unavailable keychain when the backend failed", () => {
    const location: FileLocation = {
      backend: "file",
      path: "/tmp/profiles.json",
      account: "profile:default:apiKey",
      reason: "unavailable",
    };
    expect(keyringFallbackWarning(location)).toBe(
      "warning: OS keychain unavailable; credentials stored as plaintext at /tmp/profiles.json",
    );
  });
});

describe("legacy storage detection", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
    consumeLegacyStorageWarning();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("flags an old-shape profiles.json (array of strings) as legacy and treats it as absent", async () => {
    mkdirSync(dirname(profilesFilePath()), { recursive: true });
    writeFileSync(profilesFilePath(), JSON.stringify(["staging", "prod"]));
    expect(await listProfileNames()).toEqual([]);
    expect(consumeLegacyStorageWarning()).toBe(LEGACY_STORAGE_NOTICE);
    expect(consumeLegacyStorageWarning()).toBeNull();
  });

  it("flags a legacy credentials.json sitting next to the missing new file", async () => {
    mkdirSync(dirname(legacyCredentialsPath()), { recursive: true });
    writeFileSync(
      legacyCredentialsPath(),
      JSON.stringify({
        "profile:default:apiKey": "k",
        "profile:default:url": "https://m.example.com",
      }),
    );
    expect(await listProfileNames()).toEqual([]);
    expect(consumeLegacyStorageWarning()).toBe(LEGACY_STORAGE_NOTICE);
  });

  it("deletes legacy credentials.json and rejections.json on the next successful write", async () => {
    mkdirSync(dirname(legacyCredentialsPath()), { recursive: true });
    writeFileSync(legacyCredentialsPath(), JSON.stringify({ "profile:default:apiKey": "k" }));
    writeFileSync(legacyRejectionsPath(), JSON.stringify({ default: { reason: "x" } }));

    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });

    expect(existsSync(legacyCredentialsPath())).toBe(false);
    expect(existsSync(legacyRejectionsPath())).toBe(false);
  });
});

describe("OAuth profiles (keyring backend)", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("round-trips an OAuth credential, keeping both tokens in the keyring", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH);
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: OAUTH,
    });
    expect(await readProfileRecord()).toEqual({
      name: "default",
      url: "https://m.example.com",
      apiKey: null,
      oauth: {
        accessToken: null,
        refreshToken: null,
        expiresAt: OAUTH.expiresAt,
        clientId: "client-1",
      },
      lastProbe: null,
      lastFailure: null,
    });
    expect(hoisted.store.get("metabase-cli:profile:default:oauthAccess")).toBe("access-1");
    expect(hoisted.store.get("metabase-cli:profile:default:oauthRefresh")).toBe("refresh-1");
  });

  it("switching an OAuth profile to an API key clears the OAuth tokens", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH);
    await writeProfile({ url: "https://m.example.com", apiKey: "k" });
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: { kind: "apiKey", apiKey: "k" },
    });
    expect(await readProfileRecord()).toEqual(defaultRecord(null));
    expect(hoisted.store.get("metabase-cli:profile:default:oauthAccess")).toBeUndefined();
    expect(hoisted.store.get("metabase-cli:profile:default:oauthRefresh")).toBeUndefined();
  });

  it("switching an API key profile to OAuth clears the API key", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" });
    await writeOAuthProfile("https://m.example.com", OAUTH);
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: OAUTH,
    });
    expect(await readProfileRecord()).toEqual({
      name: "default",
      url: "https://m.example.com",
      apiKey: null,
      oauth: {
        accessToken: null,
        refreshToken: null,
        expiresAt: OAUTH.expiresAt,
        clientId: "client-1",
      },
      lastProbe: null,
      lastFailure: null,
    });
    expect(hoisted.store.get("metabase-cli:profile:default:apiKey")).toBeUndefined();
  });

  it("clearProfile removes the OAuth tokens from the keyring", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH);
    expect(await clearProfile()).toBe(true);
    expect(hoisted.store.get("metabase-cli:profile:default:oauthAccess")).toBeUndefined();
    expect(hoisted.store.get("metabase-cli:profile:default:oauthRefresh")).toBeUndefined();
    expect(await readProfileCredential()).toBeNull();
  });

  it("file-fallback rotated tokens win over a stale keyring entry after the vault recovers", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH); // stored in the working keyring
    const rotated: OAuthCredential = {
      ...OAUTH,
      accessToken: "access-2",
      refreshToken: "refresh-2",
    };
    hoisted.controls.broken = true; // the vault is unavailable during the refresh
    try {
      expect(await writeOAuthProfile("https://m.example.com", rotated)).toEqual({
        backend: "file",
        path: profilesFilePath(),
        account: "profile:default:oauthAccess",
        reason: "unavailable",
      });
    } finally {
      hoisted.controls.broken = false;
    }
    // The recovered keyring still holds the pre-rotation tokens; the inline file copy is
    // authoritative, so the stale keyring entry must not shadow it.
    expect(hoisted.store.get("metabase-cli:profile:default:oauthRefresh")).toBe("refresh-1");
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: rotated,
    });
    consumeKeyringDowngradeWarning(); // drain the downgrade notice this path raised
  });

  it("flags a residual-secret warning when a keyring-backed token cannot be removed", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH); // stored in the working keyring
    expect(consumeKeychainResidualWarning()).toBeNull(); // nothing pending yet
    hoisted.controls.broken = true; // the vault now refuses deletes
    try {
      expect(await clearProfile()).toBe(true); // local record is still cleared
    } finally {
      hoisted.controls.broken = false;
    }
    expect(consumeKeychainResidualWarning()).toBe(KEYCHAIN_RESIDUAL_NOTICE);
    expect(consumeKeychainResidualWarning()).toBeNull(); // consumed exactly once
  });
});

describe("OAuth profiles (file fallback)", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = true;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    hoisted.controls.broken = false;
    home.cleanup();
  });

  it("inlines the OAuth tokens in profiles.json when the keyring is broken", async () => {
    const location = await writeOAuthProfile("https://m.example.com", OAUTH);
    expect(location).toEqual({
      backend: "file",
      path: profilesFilePath(),
      account: "profile:default:oauthAccess",
      reason: "unavailable",
    });
    expect(await readProfileRecord()).toEqual({
      name: "default",
      url: "https://m.example.com",
      apiKey: null,
      oauth: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: OAUTH.expiresAt,
        clientId: "client-1",
      },
      lastProbe: null,
      lastFailure: null,
    });
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: OAUTH,
    });
  });

  it("does not flag a residual secret for an inline (file-fallback) profile", async () => {
    await writeOAuthProfile("https://m.example.com", OAUTH); // inlined, never in the keyring
    expect(await clearProfile()).toBe(true);
    // a failed keyring delete is harmless here — the secret lived in the file we just removed
    expect(consumeKeychainResidualWarning()).toBeNull();
  });
});

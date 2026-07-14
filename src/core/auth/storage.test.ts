import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfilesFile } from "./profile-record";
import { parseJson } from "../../runtime/json";
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
  readDefaultProfileName,
  readProfileCredential,
  readProfileRecord,
  setDefaultProfile,
  writeOAuthProfile,
  writeProbeFailure,
  writeProbeResult,
  writeProfile,
} = storage;

import type { OAuthCredential } from "./credential";
import type { FileLocation } from "./storage";

const OAUTH: OAuthCredential = {
  kind: "oauth",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: "2026-06-08T13:00:00.000Z",
  clientId: "client-1",
  scope: "mb:full",
};

import { join } from "node:path";

function legacyCredentialsPath(): string {
  return join(configDir(), "credentials.json");
}

function legacyRejectionsPath(): string {
  return join(configDir(), "rejections.json");
}

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
      defaultProfile: null,
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
    if (process.platform === "win32") {
      return;
    }
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "only");
    await clearProfile("only");
    expect(() => statSync(profilesFilePath())).toThrow(/ENOENT/);
  });

  it("writes profiles.json with 0600 perms", async () => {
    if (process.platform === "win32") {
      return;
    }
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

  it("stores the API key inline in profiles.json with 0600 perms", async () => {
    if (process.platform === "win32") {
      return;
    }
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location).toEqual({
      backend: "file",
      path: profilesFilePath(),
      account: "profile:default:apiKey",
      reason: "unavailable",
    });
    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file.profiles[0]?.apiKey).toBe("secret");
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
  });

  afterEach(() => {
    home.cleanup();
  });

  it("writeProbeResult populates lastProbe and clears lastFailure", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "p");
    await writeProbeFailure("p", { kind: "auth", reason: "bad" });
    const probe = await writeProbeResult("p", {
      user: { id: 42, name: "Alice", isAdmin: true },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        tokenFeatures: null,
      },
    });
    expect(probe).not.toBeNull();
    expect(probe?.user).toEqual({ id: 42, name: "Alice", isAdmin: true });
    expect(probe?.version).toEqual({ tag: "v0.58.7", major: 58, patch: 7 });

    const record = await readProfileRecord("p");
    expect(record?.lastProbe).toEqual(probe);
    expect(record?.lastFailure).toBeNull();
  });

  it("writeProbeResult returns null and does not create a record when none exists", async () => {
    const result = await writeProbeResult("ghost", {
      user: { id: 1, name: "n", isAdmin: false },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        tokenFeatures: null,
      },
    });
    expect(result).toBeNull();
    expect(await readProfileRecord("ghost")).toBeNull();
  });

  it("writeProbeFailure updates lastFailure but leaves apiKey/url/lastProbe untouched", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" }, "p");
    const probe = await writeProbeResult("p", {
      user: { id: 1, name: "Alice", isAdmin: true },
      server: {
        version: { tag: "v0.58.7", major: 58, patch: 7 },
        tokenFeatures: null,
      },
    });
    expect(probe).not.toBeNull();

    const failure = await writeProbeFailure("p", {
      kind: "auth",
      reason: "Invalid or unauthorized API key",
    });
    expect(failure).not.toBeNull();

    const after = await readProfileRecord("p");
    expect(after?.url).toBe("https://m.example.com");
    expect(after?.lastProbe).toEqual(probe);
    expect(after?.lastFailure).toEqual(failure);
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
    expect(file.profiles[0]?.apiKey).toBe("secret");
  });

  it("treats values other than '1' as not-disabled", async () => {
    process.env["MB_CLI_DISABLE_KEYRING"] = "0";
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location.backend).toBe("keyring");
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

    expect(() => statSync(legacyCredentialsPath())).toThrow(/ENOENT/);
    expect(() => statSync(legacyRejectionsPath())).toThrow(/ENOENT/);
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
        scope: "mb:full",
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
    expect((await readProfileRecord())?.oauth).toBeNull();
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
    expect((await readProfileRecord())?.apiKey).toBeNull();
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
      expect((await writeOAuthProfile("https://m.example.com", rotated)).backend).toBe("file");
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
    expect(location.backend).toBe("file");
    expect((await readProfileRecord())?.oauth).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: OAUTH.expiresAt,
      clientId: "client-1",
      scope: "mb:full",
    });
    expect(await readProfileCredential()).toEqual({
      url: "https://m.example.com",
      credential: OAUTH,
    });
  });

  it("resolves a pre-scope profile record to the full-access scope", async () => {
    const profilesPath = join(configDir(), "profiles.json");
    mkdirSync(dirname(profilesPath), { recursive: true });
    writeFileSync(
      profilesPath,
      JSON.stringify({
        profiles: [
          {
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
          },
        ],
      }),
    );
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

describe("default profile pointer", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("is null until set", async () => {
    await writeProfile({ url: "https://child.example.com", apiKey: "mb_child" }, "ws-1");
    expect(await readDefaultProfileName()).toBeNull();
  });

  it("round-trips through the profiles file", async () => {
    await writeProfile({ url: "https://child.example.com", apiKey: "mb_child" }, "ws-1");
    await setDefaultProfile("ws-1");
    expect(await readDefaultProfileName()).toBe("ws-1");
  });

  it("clearProfile unsets the pointer when it names the removed profile", async () => {
    await writeProfile({ url: "https://parent.example.com", apiKey: "mb_parent" }, "parent");
    await writeProfile({ url: "https://child.example.com", apiKey: "mb_child" }, "ws-1");
    await setDefaultProfile("ws-1");
    expect(await clearProfile("ws-1")).toBe(true);
    expect(await readDefaultProfileName()).toBeNull();
  });

  it("clearProfile keeps the pointer when a different profile is removed", async () => {
    await writeProfile({ url: "https://parent.example.com", apiKey: "mb_parent" }, "parent");
    await writeProfile({ url: "https://child.example.com", apiKey: "mb_child" }, "ws-1");
    await setDefaultProfile("ws-1");
    expect(await clearProfile("parent")).toBe(true);
    expect(await readDefaultProfileName()).toBe("ws-1");
  });
});

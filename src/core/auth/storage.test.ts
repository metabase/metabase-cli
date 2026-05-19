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
  clearLicense,
  clearProfile,
  consumeLegacyStorageWarning,
  LEGACY_STORAGE_NOTICE,
  listProfileNames,
  listProfileRecords,
  profilesFilePath,
  readLicense,
  readProfile,
  readProfileRecord,
  writeLicense,
  writeProbeFailure,
  writeProbeResult,
  writeProfile,
} = storage;

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
          lastProbe: null,
          lastFailure: null,
        },
      ],
      license: null,
    });
  });

  it("readProfile returns the URL with the API key from the keyring", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(await readProfile()).toEqual({ url: "https://m.example.com", apiKey: "secret" });
  });

  it("isolates named profiles", async () => {
    await writeProfile({ url: "https://default.example.com", apiKey: "default-key" });
    await writeProfile({ url: "https://prod.example.com", apiKey: "prod-key" }, "prod");

    expect(await readProfile()).toEqual({
      url: "https://default.example.com",
      apiKey: "default-key",
    });
    expect(await readProfile("prod")).toEqual({
      url: "https://prod.example.com",
      apiKey: "prod-key",
    });
  });

  it("preserves user add order (no sort) and overwrites existing entries in place", async () => {
    await writeProfile({ url: "https://1.example.com", apiKey: "k1" }, "zeta");
    await writeProfile({ url: "https://2.example.com", apiKey: "k2" }, "alpha");
    await writeProfile({ url: "https://2b.example.com", apiKey: "k2b" }, "alpha");
    expect(await listProfileNames()).toEqual(["zeta", "alpha"]);
    const alpha = await readProfile("alpha");
    expect(alpha).toEqual({ url: "https://2b.example.com", apiKey: "k2b" });
  });

  it("clearProfile removes the entry from JSON and the keyring", async () => {
    await writeProfile({ url: "https://a.example.com", apiKey: "a" }, "a");
    await writeProfile({ url: "https://b.example.com", apiKey: "b" }, "b");

    expect(await clearProfile("a")).toBe(true);
    expect(await readProfile("a")).toBeNull();
    expect(hoisted.store.get("metabase-cli:profile:a:apiKey")).toBeUndefined();
    expect(await readProfile("b")).toEqual({ url: "https://b.example.com", apiKey: "b" });
  });

  it("clearProfile returns false when no entry matches the name", async () => {
    expect(await clearProfile("missing")).toBe(false);
  });

  it("deletes profiles.json when the last profile and license are gone", async () => {
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
    });
    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file.profiles[0]?.apiKey).toBe("secret");
    const mode = statSync(profilesFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("readProfile returns the inline API key when the keyring is broken", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(await readProfile()).toEqual({ url: "https://m.example.com", apiKey: "secret" });
  });

  it("stores the license inline in profiles.json when the keyring is broken", async () => {
    await writeLicense("license-token");
    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file).toEqual({ profiles: [], license: "license-token" });
    expect(await readLicense()).toBe("license-token");
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
        version: { tag: "v0.58.7", build: "oss", major: 58, patch: 7 },
        edition: "oss",
        tokenFeatures: null,
      },
    });
    expect(probe).not.toBeNull();
    expect(probe?.user).toEqual({ id: 42, name: "Alice", isAdmin: true });
    expect(probe?.version).toEqual({ tag: "v0.58.7", build: "oss", major: 58, patch: 7 });

    const record = await readProfileRecord("p");
    expect(record?.lastProbe).toEqual(probe);
    expect(record?.lastFailure).toBeNull();
  });

  it("writeProbeResult returns null and does not create a record when none exists", async () => {
    const result = await writeProbeResult("ghost", {
      user: { id: 1, name: "n", isAdmin: false },
      server: {
        version: { tag: "v0.58.7", build: "oss", major: 58, patch: 7 },
        edition: "oss",
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
        version: { tag: "v0.58.7", build: "oss", major: 58, patch: 7 },
        edition: "oss",
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

describe("license", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("round-trips via the keyring (license stays null inline)", async () => {
    await writeLicense("license-token");
    expect(await readLicense()).toBe("license-token");
    expect(hoisted.store.get("metabase-cli:license")).toBe("license-token");
  });

  it("clearLicense removes the keyring entry", async () => {
    await writeLicense("license-token");
    expect(await clearLicense()).toBe(true);
    expect(await readLicense()).toBeNull();
    expect(await clearLicense()).toBe(false);
  });

  it("license is independent of profile clears", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" });
    await writeLicense("license-token");
    expect(await clearProfile()).toBe(true);
    expect(await readLicense()).toBe("license-token");
  });
});

describe("METABASE_CLI_DISABLE_KEYRING", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
    process.env["METABASE_CLI_DISABLE_KEYRING"] = "1";
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
    });
    expect(hoisted.store.size).toBe(0);
    const file = parseJson(readFileSync(profilesFilePath(), "utf8"), ProfilesFile);
    expect(file.profiles[0]?.apiKey).toBe("secret");
  });

  it("treats values other than '1' as not-disabled", async () => {
    process.env["METABASE_CLI_DISABLE_KEYRING"] = "0";
    const location = await writeProfile({ url: "https://m.example.com", apiKey: "secret" });
    expect(location.backend).toBe("keyring");
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

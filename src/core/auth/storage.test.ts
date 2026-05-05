import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError, ValidationError } from "../errors";
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
  account,
  clearLicense,
  clearProfile,
  credentials,
  fallbackFilePath,
  readLicense,
  readProfile,
  writeLicense,
  writeProfile,
} = storage;

describe("credentials (keychain backend)", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("stores and reads via the keychain", async () => {
    const location = await credentials.set(account.profileApiKey("default"), "secret");
    expect(location).toEqual({
      backend: "keyring",
      service: "metabase-cli",
      account: "profile:default:apiKey",
    });
    expect(await credentials.read(account.profileApiKey("default"))).toBe("secret");
    expect(hoisted.store.get("metabase-cli:profile:default:apiKey")).toBe("secret");
  });

  it("does not write to the file when keychain succeeds", async () => {
    await credentials.set(account.license, "token");
    expect(() => statSync(fallbackFilePath())).toThrow(/ENOENT/);
  });

  it("removes from the keychain", async () => {
    await credentials.set(account.license, "token");
    expect(await credentials.remove(account.license)).toBe(true);
    expect(await credentials.read(account.license)).toBeNull();
    expect(await credentials.remove(account.license)).toBe(false);
  });

  it("reports the keychain as the location when keychain is healthy", async () => {
    expect(await credentials.location(account.license)).toEqual({
      backend: "keyring",
      service: "metabase-cli",
      account: "license",
    });
  });
});

describe("credentials (file fallback when keychain is broken)", () => {
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

  it("writes the value to credentials.json with 0600 perms", async () => {
    if (process.platform === "win32") {
      return;
    }
    const location = await credentials.set(account.profileApiKey("default"), "secret");
    expect(location).toEqual({
      backend: "file",
      path: fallbackFilePath(),
      account: "profile:default:apiKey",
    });
    const mode = statSync(fallbackFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("round-trips multiple accounts in the same file", async () => {
    await credentials.set(account.profileUrl("default"), "https://m.example.com");
    await credentials.set(account.profileApiKey("default"), "k1");
    await credentials.set(account.license, "license-token");

    const stored = JSON.parse(readFileSync(fallbackFilePath(), "utf8"));
    expect(stored).toEqual({
      "profile:default:url": "https://m.example.com",
      "profile:default:apiKey": "k1",
      license: "license-token",
    });

    expect(await credentials.read(account.license)).toBe("license-token");
  });

  it("removes the file when the last entry is cleared", async () => {
    await credentials.set(account.license, "token");
    await credentials.remove(account.license);
    expect(() => statSync(fallbackFilePath())).toThrow(/ENOENT/);
  });

  it("reports the file as the location when keychain is broken", async () => {
    expect(await credentials.location(account.license)).toEqual({
      backend: "file",
      path: fallbackFilePath(),
      account: "license",
    });
  });

  it("throws ConfigError when the credentials file contains malformed JSON", async () => {
    const path = fallbackFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json }");
    const error = await credentials.read(account.license).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(error.message).toContain(path);
    expect(error.message).toContain("invalid JSON: ");
  });

  it("throws ValidationError when the credentials file contains a non-string value", async () => {
    const path = fallbackFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ license: 42 }));
    const error = await credentials.read(account.license).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    expect(error.message).toContain(path);
    expect(error.developerDetail.zodIssues[0]?.path).toEqual(["license"]);
  });
});

describe("profiles", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    hoisted.controls.broken = false;
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("round-trips the default profile", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" });
    expect(await readProfile()).toEqual({ url: "https://m.example.com", apiKey: "k" });
  });

  it("isolates named profiles from the default profile", async () => {
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

  it("returns null when only one of url/apiKey is stored", async () => {
    await credentials.set(account.profileUrl("default"), "https://m.example.com");
    expect(await readProfile()).toBeNull();
  });

  it("clears a profile without affecting others", async () => {
    await writeProfile({ url: "https://a.example.com", apiKey: "a" }, "a");
    await writeProfile({ url: "https://b.example.com", apiKey: "b" }, "b");

    expect(await clearProfile("a")).toBe(true);
    expect(await readProfile("a")).toBeNull();
    expect(await readProfile("b")).toEqual({ url: "https://b.example.com", apiKey: "b" });
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
    const location = await credentials.set(account.profileApiKey("default"), "secret");
    expect(location).toEqual({
      backend: "file",
      path: fallbackFilePath(),
      account: "profile:default:apiKey",
    });
    expect(hoisted.store.size).toBe(0);
    const stored = JSON.parse(readFileSync(fallbackFilePath(), "utf8"));
    expect(stored).toEqual({ "profile:default:apiKey": "secret" });
  });

  it("reads from the file even when a value sits in the keyring", async () => {
    hoisted.store.set("metabase-cli:license", "from-keyring");
    expect(await credentials.read(account.license)).toBeNull();

    await credentials.set(account.license, "from-file");
    expect(await credentials.read(account.license)).toBe("from-file");
  });

  it("reports backend: file from credentials.location", async () => {
    hoisted.store.set("metabase-cli:license", "from-keyring");
    expect(await credentials.location(account.license)).toEqual({
      backend: "file",
      path: fallbackFilePath(),
      account: "license",
    });
  });

  it("remove only touches the file backend", async () => {
    hoisted.store.set("metabase-cli:license", "from-keyring");
    await credentials.set(account.license, "from-file");

    expect(await credentials.remove(account.license)).toBe(true);
    expect(await credentials.read(account.license)).toBeNull();
    expect(hoisted.store.get("metabase-cli:license")).toBe("from-keyring");
  });

  it("treats values other than '1' as not-disabled", async () => {
    process.env["METABASE_CLI_DISABLE_KEYRING"] = "0";
    const location = await credentials.set(account.license, "token");
    expect(location.backend).toBe("keyring");
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

  it("round-trips a license token", async () => {
    await writeLicense("license-token");
    expect(await readLicense()).toBe("license-token");
  });

  it("clears the license", async () => {
    await writeLicense("license-token");
    expect(await clearLicense()).toBe(true);
    expect(await readLicense()).toBeNull();
  });

  it("license is independent of profiles", async () => {
    await writeProfile({ url: "https://m.example.com", apiKey: "k" });
    await writeLicense("license-token");
    expect(await clearProfile()).toBe(true);
    expect(await readLicense()).toBe("license-token");
  });
});

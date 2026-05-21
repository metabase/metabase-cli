import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("./auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import { writeProbeFailure, writeProbeResult, writeProfile } from "./auth/storage";
import { setupTempConfigHome, type TempConfigHome } from "./auth/temp-config-home";
import { explicitProfileName, resolveConfig, resolveProfileName } from "./config";
import { ConfigError } from "./errors";

describe("resolveConfig", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    hoisted.store.clear();
    home = setupTempConfigHome();
    delete process.env["METABASE_URL"];
    delete process.env["METABASE_API_KEY"];
    delete process.env["METABASE_PROFILE"];
  });

  afterEach(() => {
    home.cleanup();
  });

  it("prefers flags over environment and stored creds", async () => {
    process.env["METABASE_URL"] = "http://env";
    process.env["METABASE_API_KEY"] = "env-key";
    const config = await resolveConfig({
      url: "https://flag.example.com",
      apiKey: "flag-key",
    });
    expect(config).toEqual({
      url: "https://flag.example.com",
      apiKey: "flag-key",
      profile: "default",
      source: "flag",
    });
  });

  it("falls back to environment", async () => {
    process.env["METABASE_URL"] = "https://env.example.com/";
    process.env["METABASE_API_KEY"] = "env-key";
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://env.example.com",
      apiKey: "env-key",
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
      apiKey: "saved-key",
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
      apiKey: "staging-key",
      profile: "staging",
      source: "stored",
    });
  });

  it("reads the named profile when METABASE_PROFILE is set", async () => {
    await writeProfile({ url: "https://default.example.com", apiKey: "default-key" });
    await writeProfile({ url: "https://prod.example.com", apiKey: "prod-key" }, "prod");
    process.env["METABASE_PROFILE"] = "prod";
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://prod.example.com",
      apiKey: "prod-key",
      profile: "prod",
      source: "stored",
    });
  });

  it("flag profile beats METABASE_PROFILE env var", async () => {
    await writeProfile({ url: "https://staging.example.com", apiKey: "staging-key" }, "staging");
    await writeProfile({ url: "https://prod.example.com", apiKey: "prod-key" }, "prod");
    process.env["METABASE_PROFILE"] = "prod";
    const config = await resolveConfig({ profile: "staging" });
    expect(config).toEqual({
      url: "https://staging.example.com",
      apiKey: "staging-key",
      profile: "staging",
      source: "stored",
    });
  });

  it("composes flag-only url with stored apiKey (mixed source)", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" });
    const config = await resolveConfig({ url: "https://override.example.com" });
    expect(config).toEqual({
      url: "https://override.example.com",
      apiKey: "saved-key",
      profile: "default",
      source: "mixed",
    });
  });

  it("composes env-only apiKey with stored url (mixed source)", async () => {
    await writeProfile({ url: "https://saved.example.com", apiKey: "saved-key" });
    process.env["METABASE_API_KEY"] = "env-key";
    const config = await resolveConfig({});
    expect(config).toEqual({
      url: "https://saved.example.com",
      apiKey: "env-key",
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
      apiKey: "saved-key",
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
    delete process.env["METABASE_PROFILE"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the flag value when provided", () => {
    process.env["METABASE_PROFILE"] = "env-profile";
    expect(resolveProfileName("flag-profile")).toBe("flag-profile");
  });

  it("falls back to METABASE_PROFILE when no flag", () => {
    process.env["METABASE_PROFILE"] = "env-profile";
    expect(resolveProfileName(undefined)).toBe("env-profile");
  });

  it("falls back to default when neither flag nor env is set", () => {
    expect(resolveProfileName(undefined)).toBe("default");
  });
});

describe("explicitProfileName", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env["METABASE_PROFILE"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the flag value when provided", () => {
    process.env["METABASE_PROFILE"] = "env-profile";
    expect(explicitProfileName("flag-profile")).toBe("flag-profile");
  });

  it("returns METABASE_PROFILE when no flag", () => {
    process.env["METABASE_PROFILE"] = "env-profile";
    expect(explicitProfileName(undefined)).toBe("env-profile");
  });

  it("returns null when neither flag nor env is set", () => {
    expect(explicitProfileName(undefined)).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  store: new Map<string, string>(),
  controls: { broken: false },
}));

vi.mock("@napi-rs/keyring", async () => {
  const { createKeyringMockModule } = await import("./auth/keyring-mock");
  return createKeyringMockModule(hoisted);
});

import { recordRejection } from "./auth/rejection";
import { writeProfile } from "./auth/storage";
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
    expect(error).toMatchObject({ message: expect.stringContaining('profile "missing"') });
  });

  it("throws ConfigError when nothing is configured", async () => {
    const error = await resolveConfig({}).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({ message: expect.stringContaining("Not authenticated") });
  });

  it("surfaces a prior login rejection when nothing is configured", async () => {
    await recordRejection("cohort_retention", {
      reason: "Invalid or unauthorized API key",
      url: "https://metabase.example.com/admin",
    });
    const error = await resolveConfig({ profile: "cohort_retention" }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(error.message).toBe(
      'Last login for profile "cohort_retention" was rejected by https://metabase.example.com: Invalid or unauthorized API key. Re-run `metabase auth login --profile cohort_retention` with valid credentials.',
    );
  });

  it("ignores the rejection record when stored credentials are still present", async () => {
    await writeProfile(
      { url: "https://saved.example.com", apiKey: "saved-key" },
      "cohort_retention",
    );
    await recordRejection("cohort_retention", {
      reason: "Invalid or unauthorized API key",
      url: "https://saved.example.com",
    });
    const config = await resolveConfig({ profile: "cohort_retention" });
    expect(config).toEqual({
      url: "https://saved.example.com",
      apiKey: "saved-key",
      profile: "cohort_retention",
      source: "stored",
    });
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

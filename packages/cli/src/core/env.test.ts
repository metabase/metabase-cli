import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { consumeLegacyEnvWarnings, ENV_URL, readEnv } from "./env";

describe("readEnv", () => {
  beforeEach(() => {
    delete process.env["MB_URL"];
    delete process.env["METABASE_URL"];
    consumeLegacyEnvWarnings();
  });

  afterEach(() => {
    delete process.env["MB_URL"];
    delete process.env["METABASE_URL"];
  });

  it("returns undefined and records no warning when neither variant is set", () => {
    expect(readEnv(ENV_URL)).toBeUndefined();
    expect(consumeLegacyEnvWarnings()).toEqual([]);
  });

  it("reads the canonical MB_ variant without warning", () => {
    process.env["MB_URL"] = "https://canonical.example.com";
    expect(readEnv(ENV_URL)).toBe("https://canonical.example.com");
    expect(consumeLegacyEnvWarnings()).toEqual([]);
  });

  it("falls back to the legacy METABASE_ variant and records a warning", () => {
    process.env["METABASE_URL"] = "https://legacy.example.com";
    expect(readEnv(ENV_URL)).toBe("https://legacy.example.com");
    expect(consumeLegacyEnvWarnings()).toEqual([
      "warning: METABASE_URL is deprecated; set MB_URL instead",
    ]);
  });

  it("prefers the canonical variant when both are set, without warning", () => {
    process.env["MB_URL"] = "https://canonical.example.com";
    process.env["METABASE_URL"] = "https://legacy.example.com";
    expect(readEnv(ENV_URL)).toBe("https://canonical.example.com");
    expect(consumeLegacyEnvWarnings()).toEqual([]);
  });

  it("clears recorded warnings once consumed", () => {
    process.env["METABASE_URL"] = "https://legacy.example.com";
    readEnv(ENV_URL);
    expect(consumeLegacyEnvWarnings()).toEqual([
      "warning: METABASE_URL is deprecated; set MB_URL instead",
    ]);
    expect(consumeLegacyEnvWarnings()).toEqual([]);
  });
});

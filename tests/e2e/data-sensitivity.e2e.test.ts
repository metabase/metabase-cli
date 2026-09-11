import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const EE_UNAVAILABLE = requireServer("data-sensitivity › against EE endpoints", {
  minVersion: 64,
  tokenFeature: "data_sensitivity",
});

// The compose stack configures no AI provider, so on a server that grants the feature the first
// gate the scan reaches after the write check is the provider pre-flight.
const NO_PROVIDER_MESSAGE = "No AI provider is configured for Metabot.";

describe("data-sensitivity arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("scan-db with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["data-sensitivity", "scan-db", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("scan-table with an unknown --status fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["data-sensitivity", "scan-table", "1", "--status", "disagree,bogus", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "invalid --status value: bogus (expected one of: agree, disagree, new, abstain, dropped)",
    );
    expect(result.stdout).toBe("");
  });

  it("scan-db with a zero --timeout fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["data-sensitivity", "scan-db", "1", "--timeout", "0", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid timeout: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });
});

describe.skipIf(EE_UNAVAILABLE !== null)("data-sensitivity e2e against EE endpoints", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("scan-db stops at the provider pre-flight when no AI provider is configured", async () => {
    const result = await runCli({
      args: ["data-sensitivity", "scan-db", String(SEEDED.warehouseDbId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
    expect(cliErrorMessage(result.stderr)).toBe(NO_PROVIDER_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("scan-table against a missing table id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["data-sensitivity", "scan-table", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(
      "Not found: POST /api/ee/data-sensitivity/table/9999999.",
    );
    expect(result.stdout).toBe("");
  });
});

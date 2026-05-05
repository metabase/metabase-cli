import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DatabaseListEnvelope } from "../../src/commands/db/list";
import { DatabaseCompact } from "../../src/domain/database";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES } from "./seed/ids";

describe("db e2e", () => {
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list returns the seeded warehouse database in compact form", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["db", "list", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseListEnvelope)).toEqual({
      data: [{ id: E2E_DATABASES.WAREHOUSE, name: "Warehouse", engine: "postgres" }],
      returned: 1,
      total: 1,
    });
  });

  it("get returns the warehouse by id", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["db", "get", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseCompact)).toEqual({
      id: E2E_DATABASES.WAREHOUSE,
      name: "Warehouse",
      engine: "postgres",
    });
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["db", "get", "abc", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing database id surfaces a 404 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["db", "get", "9999999", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });
});

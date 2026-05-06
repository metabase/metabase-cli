import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FieldCompact } from "../../src/domain/field";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_FIELDS, E2E_TABLES } from "./seed/ids";

describe("field e2e", () => {
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

  it("get returns the customers.email field with the expected compact projection", async () => {
    const result = await runCli({
      args: ["field", "get", String(E2E_FIELDS.CUSTOMERS_EMAIL), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldCompact)).toEqual({
      id: E2E_FIELDS.CUSTOMERS_EMAIL,
      name: "email",
      display_name: "Email",
      description: null,
      table_id: E2E_TABLES.CUSTOMERS,
      base_type: "type/Text",
      semantic_type: "type/Email",
      fk_target_field_id: null,
    });
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["field", "get", "x", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "x" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing field id surfaces a 404 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["field", "get", "9999999", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });
});

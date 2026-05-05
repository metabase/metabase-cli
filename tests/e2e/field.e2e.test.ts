import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TableListEnvelope } from "../../src/commands/table/list";
import { Field, FieldCompact } from "../../src/domain/field";
import { Table } from "../../src/domain/table";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES } from "./seed/ids";

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

  async function lookupCustomersEmailField(configHome: string): Promise<Field> {
    const list = await runCli({
      args: ["table", "list", "--db-id", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome,
      env: authEnv(),
    });
    const customers = parseJson(list.stdout, TableListEnvelope).data.find(
      (row) => row.name === "customers",
    );
    if (customers === undefined) {
      throw new Error("customers table missing from list output");
    }

    const get = await runCli({
      args: [
        "table",
        "get",
        String(customers.id),
        "--json",
        "--detail",
        "full",
        "--max-bytes",
        "0",
      ],
      configHome,
      env: authEnv(),
    });
    const table = parseJson(get.stdout, Table);
    const email = (table.fields ?? []).find((field) => field.name === "email");
    if (email === undefined) {
      throw new Error("email field missing from customers query_metadata");
    }
    return email;
  }

  it("get returns the customers.email field with the expected compact projection", async () => {
    const configHome = await makeIsolatedConfigHome();
    const email = await lookupCustomersEmailField(configHome);

    const result = await runCli({
      args: ["field", "get", String(email.id), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldCompact)).toEqual({
      id: email.id,
      name: "email",
      display_name: "Email",
      description: null,
      table_id: email.table_id,
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

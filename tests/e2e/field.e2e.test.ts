import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";

import { createClient } from "../../src/core/http/client";
import { Field, FieldCompact, FieldSummary, FieldValues } from "../../src/domain/field";
import { TableQueryMetadata } from "../../src/domain/table";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";
describe("field e2e", () => {
  let bootstrap: E2EBootstrap;
  let customersEmailFieldId: number;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    customersEmailFieldId = await resolveFieldId(SEEDED.tables.customers, "email");
  });

  async function resolveFieldId(tableId: number, fieldName: string): Promise<number> {
    const client = createClient({
      url: bootstrap.baseUrl,
      credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey },
    });
    const metadata = await client.requestParsed(
      TableQueryMetadata,
      `/api/table/${tableId}/query_metadata`,
    );
    const field = metadata.fields.find((entry) => entry.name === fieldName);
    assert(
      field,
      `expected table ${tableId} to expose a field named ${fieldName}, ` +
        `got: ${metadata.fields.map((entry) => entry.name).join(", ")}`,
    );
    return field.id;
  }

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
      args: ["field", "get", String(customersEmailFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, FieldCompact)).toEqual({
      id: customersEmailFieldId,
      name: "email",
      display_name: "Email",
      description: null,
      table_id: SEEDED.tables.customers,
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
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "x" (expected integer)');
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
    expect(result.stderr).toContain("Not found: GET /api/field/9999999.");
  });

  it("values returns the FieldValues envelope for the email field", async () => {
    const result = await runCli({
      args: ["field", "values", String(customersEmailFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, FieldValues);
    expect(parsed.field_id).toBe(customersEmailFieldId);
  });

  it("values with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "values", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("summary returns the count and distinct count for the email field", async () => {
    const result = await runCli({
      args: ["field", "summary", String(customersEmailFieldId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, FieldSummary);
    expect(parsed.field_id).toBe(customersEmailFieldId);
  });

  it("summary against a missing field id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["field", "summary", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/field/9999999/summary.");
  });

  it("update edits the email field description and restores it", async () => {
    const newDescription = `e2e field update marker ${Date.now()}`;
    const update = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        JSON.stringify({ description: newDescription }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, Field).description).toBe(newDescription);

    const restore = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        JSON.stringify({ description: null }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(restore.exitCode, restore.stderr).toBe(0);
    expect(parseJson(restore.stdout, Field).description).toBeNull();
  });

  it("update rejects multiple body sources", async () => {
    const result = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        '{"description":"x"}',
        "--file",
        "patch.json",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("multiple body sources given");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "update", "abc", "--body", '{"description":"x"}', "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("update enforces the input schema for an unknown enum value", async () => {
    const result = await runCli({
      args: [
        "field",
        "update",
        String(customersEmailFieldId),
        "--body",
        JSON.stringify({ visibility_type: "not-a-real-value" }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("value did not match expected schema");
  });
});

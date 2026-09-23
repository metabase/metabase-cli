import { assert, beforeAll, describe, expect, it } from "vitest";

import { FieldCompact, FieldSummary, FieldValues } from "@metabase/client/domain/field";
import { TableQueryMetadata } from "@metabase/client/domain/table";
import { createTransport } from "@metabase/client/http/transport";
import { parseJson } from "@metabase/client/json";

import { USER_AGENT } from "../../packages/cli/src/core/user-agent";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

describe("field e2e", () => {
  let bootstrap: E2EBootstrap;
  let customersEmailFieldId: number;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    customersEmailFieldId = await resolveFieldId(SEEDED.tables.customers, "email");
  });

  async function resolveFieldId(tableId: number, fieldName: string): Promise<number> {
    const client = createTransport(
      { url: bootstrap.baseUrl, credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey } },
      { userAgent: USER_AGENT },
    );
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

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("get returns the customers.email field with the expected compact projection", async () => {
    const result = await runCli({
      args: ["field", "get", String(customersEmailFieldId), "--json"],
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
    const result = await runCli({
      args: ["field", "get", "x", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "x" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing field id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["field", "get", "9999999", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/field/9999999.");
  });

  it("values returns the FieldValues envelope for the email field", async () => {
    const result = await runCli({
      args: ["field", "values", String(customersEmailFieldId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, FieldValues);
    expect(parsed.field_id).toBe(customersEmailFieldId);
  });

  it("values with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["field", "values", "abc", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("summary returns the count and distinct count for the email field", async () => {
    const result = await runCli({
      args: ["field", "summary", String(customersEmailFieldId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, FieldSummary);
    expect(parsed.field_id).toBe(customersEmailFieldId);
  });

  it("summary against a missing field id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["field", "summary", "9999999", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/field/9999999/summary.");
  });
});

import { beforeAll, describe, expect, it } from "vitest";

import {
  Card,
  CardCompact,
  CardQueryResult,
  CardQueryResultCompact,
} from "@metabase/client/domain/card";
import { parseJson } from "@metabase/client/json";

import { CardListEnvelope } from "../../packages/cli/src/commands/card/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { assertCompactColumns, assertCompletedQuery } from "./card-query";
import { runCli } from "./run-cli";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

const ORDERS_BY_STATUS_NAME = "Orders by status";

const ORDERS_BY_STATUS_COMPACT = {
  id: SEEDED.ordersCardId,
  name: ORDERS_BY_STATUS_NAME,
  type: "question",
  display: "table",
  archived: false,
  database_id: SEEDED.warehouseDbId,
  collection_id: SEEDED.defaultCollectionId,
  description: null,
} as const;

describe("card e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list returns the seeded Orders-by-status card with no archived rows", async () => {
    const result = await runCli({
      args: ["card", "list", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CardListEnvelope);
    expect(envelope.data.find((row) => row.id === SEEDED.ordersCardId)).toEqual(
      ORDERS_BY_STATUS_COMPACT,
    );
    expect(envelope.data.filter((row) => row.archived)).toEqual([]);
  });

  it("get returns the seeded card by id in compact form", async () => {
    const result = await runCli({
      args: ["card", "get", String(SEEDED.ordersCardId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardCompact)).toEqual(ORDERS_BY_STATUS_COMPACT);
  });

  it("get --full returns the full card with dataset_query and query_type", async () => {
    const result = await runCli({
      args: ["card", "get", String(SEEDED.ordersCardId), "--json", "--full"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const card = parseJson(result.stdout, Card);
    expect({
      id: card.id,
      query_type: card.query_type,
      creator_id: card.creator_id,
      table_id: card.table_id,
      dashboard_id: card.dashboard_id,
    }).toEqual({
      id: SEEDED.ordersCardId,
      query_type: "native",
      creator_id: 2,
      table_id: null,
      dashboard_id: null,
    });
  });

  it("list with a rejected --limit fails with a ConfigError envelope and an empty stdout", async () => {
    const result = await runCli({
      args: ["card", "list", "--limit", "0", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe("invalid --limit: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "get", "abc", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing card id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["card", "get", "9999999", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/card/9999999.");
  });

  it("query (json) returns the compact projection: slim columns, heavy envelope metadata dropped", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    // Parse through the loose full schema to inspect exactly what the CLI printed: the compact
    // projection must have dropped the per-column metadata and the envelope-level blocks.
    const printed = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(printed);
    assertCompactColumns(printed);
    expect(printed).not.toHaveProperty("json_query");
    expect(printed.data).not.toHaveProperty("results_metadata");
    expect(printed.data).not.toHaveProperty("native_form");

    // The slim output still satisfies the compact schema contract against the live /api/dataset.
    const compact = parseJson(result.stdout, CardQueryResultCompact);
    expect({
      status: compact.status,
      row_count: compact.row_count,
      rowsLength: compact.data?.rows.length,
      colNames: compact.data?.cols.map((column) => column.name),
    }).toEqual({
      status: "completed",
      row_count: 5,
      rowsLength: 5,
      colNames: ["status", "n"],
    });
  });

  it("query --json --full returns the raw /api/dataset envelope with json_query and results_metadata", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--json", "--full"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const printed = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(printed);
    expect(printed).toHaveProperty("json_query");
    expect(printed.data).toHaveProperty("results_metadata");
  });

  it("query --limit truncates the rows kept in the JSON envelope", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--json", "--limit", "2"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(parsed);
    expect({
      rowsLength: parsed.data.rows.length,
      row_count: parsed.row_count,
    }).toEqual({
      rowsLength: 2,
      row_count: 5,
    });
  });

  it("query --export-format csv streams a CSV with the expected header and rows", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--export-format", "csv"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("status,n");
    expect(lines.length).toBe(6);
  });

  it("query --export-format xlsx streams an XLSX file (zip magic bytes)", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--export-format", "xlsx"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.slice(0, 4)).toBe("\x50\x4b\x03\x04");
  });

  it("query --export-format with an invalid value fails with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--export-format", "html"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid --export-format: "html" (expected: csv, json, xlsx)',
    );
    expect(result.stdout).toBe("");
  });

  it("query --parameters with malformed JSON fails fast with a parse error", async () => {
    const result = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--parameters", "not-json", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--parameters: invalid JSON");
    expect(result.stdout).toBe("");
  });
});

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CardListEnvelope } from "../../src/commands/card/list";
import { ValidationOutcome } from "../../src/core/schema/validate";
import { Card, CardCompact, CardQueryResult } from "../../src/domain/card";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { assertCompletedQuery } from "./card-query";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_CARDS, E2E_COLLECTIONS, E2E_DATABASES, E2E_TABLES } from "./seed/ids";

const FIRST_NEW_CARD_ID = 95;
const NEW_CARD_NAME = "e2e_card_new";
const ORDERS_BY_STATUS_NAME = "Orders by status";

const ORDERS_BY_STATUS_COMPACT = {
  id: E2E_CARDS.ORDERS_BY_STATUS,
  name: ORDERS_BY_STATUS_NAME,
  type: "question",
  display: "table",
  archived: false,
  database_id: E2E_DATABASES.WAREHOUSE,
  collection_id: E2E_COLLECTIONS.DEFAULT,
  description: null,
} as const;

const NEW_CARD_COMPACT = {
  id: FIRST_NEW_CARD_ID,
  name: NEW_CARD_NAME,
  type: "question",
  display: "table",
  archived: false,
  database_id: E2E_DATABASES.WAREHOUSE,
  collection_id: E2E_COLLECTIONS.DEFAULT,
  description: null,
} as const;

interface NativeQueryBody {
  type: "native";
  database: number;
  native: { query: string };
}

interface CardCreateBody {
  name: string;
  display: "table";
  visualization_settings: Record<string, unknown>;
  collection_id: number;
  dataset_query: NativeQueryBody;
}

const NEW_CARD_BODY: CardCreateBody = {
  name: NEW_CARD_NAME,
  display: "table",
  visualization_settings: {},
  collection_id: E2E_COLLECTIONS.DEFAULT,
  dataset_query: {
    type: "native",
    database: E2E_DATABASES.WAREHOUSE,
    native: { query: "SELECT 2 AS x" },
  },
};

describe("card e2e", () => {
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

  async function archiveCard(id: number): Promise<CardCompact> {
    const result = await runCli({
      args: ["card", "archive", String(id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, CardCompact);
  }

  it("list returns the seeded Orders-by-status card with no archived rows", async () => {
    const result = await runCli({
      args: ["card", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, CardListEnvelope);
    expect(envelope.data.find((row) => row.id === E2E_CARDS.ORDERS_BY_STATUS)).toEqual(
      ORDERS_BY_STATUS_COMPACT,
    );
    expect(envelope.data.filter((row) => row.archived)).toEqual([]);
  });

  it("list --filter archived returns the archived card and excludes the active one", async () => {
    const archived = await archiveCard(E2E_CARDS.ORDERS_BY_STATUS);
    expect(archived).toEqual({ ...ORDERS_BY_STATUS_COMPACT, archived: true });

    const result = await runCli({
      args: ["card", "list", "--filter", "archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardListEnvelope)).toEqual({
      data: [{ ...ORDERS_BY_STATUS_COMPACT, archived: true }],
      returned: 1,
      total: 1,
    });
  });

  it("get returns the seeded card by id in compact form", async () => {
    const result = await runCli({
      args: ["card", "get", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardCompact)).toEqual(ORDERS_BY_STATUS_COMPACT);
  });

  it("get --full returns the full card with dataset_query and query_type", async () => {
    const result = await runCli({
      args: ["card", "get", String(E2E_CARDS.ORDERS_BY_STATUS), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
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
      id: E2E_CARDS.ORDERS_BY_STATUS,
      query_type: "native",
      creator_id: 2,
      table_id: null,
      dashboard_id: null,
    });
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing card id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["card", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("query (json) executes the card and returns the full result envelope", async () => {
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(parsed);
    expect({
      status: parsed.status,
      row_count: parsed.row_count,
      rowsLength: parsed.data.rows.length,
      colNames: parsed.data.cols.map((column) => column.name),
    }).toEqual({
      status: "completed",
      row_count: 5,
      rowsLength: 5,
      colNames: ["status", "n"],
    });
  });

  it("query --limit truncates the rows kept in the JSON envelope", async () => {
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--json", "--limit", "2"],
      configHome: await makeIsolatedConfigHome(),
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
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--export-format", "csv"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("status,n");
    expect(lines.length).toBe(6);
  });

  it("query --export-format xlsx streams an XLSX file (zip magic bytes)", async () => {
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--export-format", "xlsx"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.slice(0, 4)).toBe("\x50\x4b\x03\x04");
  });

  it("query --export-format with an invalid value fails with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--export-format", "html"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid --export-format: "html" (expected: csv, json, xlsx)');
    expect(result.stdout).toBe("");
  });

  it("query --parameters with malformed JSON fails fast with a parse error", async () => {
    const result = await runCli({
      args: [
        "card",
        "query",
        String(E2E_CARDS.ORDERS_BY_STATUS),
        "--parameters",
        "not-json",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--parameters: invalid JSON");
    expect(result.stdout).toBe("");
  });

  it("create + archive round-trip flips archived from false to true", async () => {
    const createResult = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify(NEW_CARD_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(createResult.exitCode, createResult.stderr).toBe(0);
    expect(parseJson(createResult.stdout, CardCompact)).toEqual(NEW_CARD_COMPACT);

    const archived = await archiveCard(FIRST_NEW_CARD_ID);
    expect(archived).toEqual({ ...NEW_CARD_COMPACT, archived: true });
  });

  it("create with a body missing required fields fails on Zod validation", async () => {
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-required" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create with invalid MBQL 5 dataset_query fails pre-flight before sending", async () => {
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({
        name: "preflight-fail",
        display: "table",
        visualization_settings: {},
        collection_id: E2E_COLLECTIONS.DEFAULT,
        dataset_query: {
          "lib/type": "mbql/query",
          database: "oops not an integer",
          stages: [
            {
              "lib/type": "mbql.stage/mbql",
              "source-table": E2E_TABLES.ORDERS,
            },
          ],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
    expect(result.stderr).toContain(
      "card.dataset_query validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
    );
  });

  it("create --skip-validate bypasses the MBQL 5 pre-flight (server is the authority)", async () => {
    const result = await runCli({
      args: ["card", "create", "--skip-validate", "--json"],
      stdin: JSON.stringify({
        name: "skip-validate-bypass",
        display: "table",
        visualization_settings: {},
        collection_id: E2E_COLLECTIONS.DEFAULT,
        dataset_query: {
          "lib/type": "mbql/query",
          database: "oops not an integer",
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": E2E_TABLES.ORDERS }],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    // Pre-flight is bypassed; the server then rejects the malformed body with an HttpError (exit 1).
    // The card-create endpoint surfaces the underlying app-DB constraint message via the response
    // envelope; we assert a stable substring of that surfaced error.
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('NULL not allowed for column "DATABASE_ID"');
    expect(result.stdout).toBe("");
  });

  it("archive with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "archive", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("update renames the card and the compact view reflects the new name", async () => {
    const result = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      stdin: JSON.stringify({ name: "Orders by status (renamed)" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardCompact)).toEqual({
      ...ORDERS_BY_STATUS_COMPACT,
      name: "Orders by status (renamed)",
    });
  });

  it("update flips archived to true and the archived list reflects it", async () => {
    const updateResult = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      stdin: JSON.stringify({ archived: true }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, CardCompact)).toEqual({
      ...ORDERS_BY_STATUS_COMPACT,
      archived: true,
    });

    const archivedListResult = await runCli({
      args: ["card", "list", "--filter", "archived", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(archivedListResult.exitCode, archivedListResult.stderr).toBe(0);
    expect(parseJson(archivedListResult.stdout, CardListEnvelope)).toEqual({
      data: [{ ...ORDERS_BY_STATUS_COMPACT, archived: true }],
      returned: 1,
      total: 1,
    });
  });

  it("update changes display from table to bar without disturbing other fields", async () => {
    const result = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      stdin: JSON.stringify({ display: "bar" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardCompact)).toEqual({
      ...ORDERS_BY_STATUS_COMPACT,
      display: "bar",
    });
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["card", "update", "abc", "--json"],
      stdin: JSON.stringify({ name: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("update against a missing card id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["card", "update", "9999999", "--json"],
      stdin: JSON.stringify({ name: "x" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("update with invalid MBQL 5 dataset_query fails pre-flight before sending", async () => {
    const result = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      stdin: JSON.stringify({
        dataset_query: {
          "lib/type": "mbql/query",
          database: "oops not an integer",
          stages: [
            {
              "lib/type": "mbql.stage/mbql",
              "source-table": E2E_TABLES.ORDERS,
            },
          ],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
    expect(result.stderr).toContain(
      "card.dataset_query validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
    );
  });

  it("update --skip-validate bypasses the MBQL 5 pre-flight (server is the authority)", async () => {
    const result = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--skip-validate", "--json"],
      stdin: JSON.stringify({
        dataset_query: {
          "lib/type": "mbql/query",
          database: "oops not an integer",
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": E2E_TABLES.ORDERS }],
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    // PUT /api/card/:id accepts dataset_query as an opaque map and does not validate its inner
    // shape, so the bad `database` does not trigger a 400. Bypass is proven by exit 0 — without
    // --skip-validate the prior test shows pre-flight rejects with exit 2.
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CardCompact).id).toBe(E2E_CARDS.ORDERS_BY_STATUS);
  });

  it("create with dataset_query: {} is rejected at the CLI boundary (no H2 stack trace)", async () => {
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({
        name: "empty-dataset-query",
        display: "table",
        visualization_settings: {},
        collection_id: E2E_COLLECTIONS.DEFAULT,
        dataset_query: {},
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stderr).toContain(
      'dataset_query must include "lib/type" (MBQL 5) or "type" (legacy MBQL/native); empty `{}` is rejected',
    );
    expect(result.stderr).not.toContain("DATABASE_ID");
    expect(result.stdout).toBe("");
  });

  it("create with dataset_query: null is rejected at the CLI boundary", async () => {
    const result = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({
        name: "null-dataset-query",
        display: "table",
        visualization_settings: {},
        collection_id: E2E_COLLECTIONS.DEFAULT,
        dataset_query: null,
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stderr).toContain("expected object, received null");
    expect(result.stdout).toBe("");
  });

  it("update with dataset_query: {} is rejected at the CLI boundary", async () => {
    const result = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      stdin: JSON.stringify({ dataset_query: {} }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stderr).toContain(
      'dataset_query must include "lib/type" (MBQL 5) or "type" (legacy MBQL/native); empty `{}` is rejected',
    );
    expect(result.stdout).toBe("");
  });

  it("update with dataset_query: null is rejected at the CLI boundary", async () => {
    const result = await runCli({
      args: ["card", "update", String(E2E_CARDS.ORDERS_BY_STATUS), "--json"],
      stdin: JSON.stringify({ dataset_query: null }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stderr).toContain("expected object, received null");
    expect(result.stdout).toBe("");
  });
});

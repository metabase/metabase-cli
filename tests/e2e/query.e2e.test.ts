import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CardQueryResult, CardQueryResultCompact } from "@metabase/client/domain/card";
import { CompiledQuery, QueryMetadataCompact } from "@metabase/client/domain/dataset";
import { parseJson } from "@metabase/client/json";

import {
  getQuerySchemaBundle,
  QuerySchemaBundle,
  ValidationOutcome,
} from "../../packages/cli/src/core/schema/validate";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { assertCompactColumns, assertCompletedQuery } from "./card-query";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { QUERY_NORMALIZATION_MESSAGE, serverHas } from "./server-gate";
import { SEEDED } from "./seed/seeded";

const VALID_QUERY = {
  "lib/type": "mbql/query",
  database: SEEDED.warehouseDbId,
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": SEEDED.tables.orders,
    },
  ],
};

const STRING_FK_BODY = {
  "lib/type": "mbql/query",
  database: "My DB",
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": ["My DB", null, "orders"],
    },
  ],
};

const EMPTY_STAGES_QUERY = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [],
};

const ORDERS_BY_STATUS_SQL = "SELECT status, COUNT(*) AS n FROM orders GROUP BY status";
const ORDERS_STATUS_COUNT = 5;

function ordersQuery(): Record<string, unknown> {
  return {
    "lib/type": "mbql/query",
    database: SEEDED.warehouseDbId,
    stages: [{ "lib/type": "mbql.stage/mbql", "source-table": SEEDED.tables.orders }],
  };
}

// Aggregated, so no generation of the server appends its default row limit to the compiled SQL.
function ordersCountQuery(): Record<string, unknown> {
  return {
    "lib/type": "mbql/query",
    database: SEEDED.warehouseDbId,
    stages: [
      {
        "lib/type": "mbql.stage/mbql",
        "source-table": SEEDED.tables.orders,
        aggregation: [["count", {}]],
      },
    ],
  };
}

function ordersByStatusNative(): Record<string, unknown> {
  return {
    type: "native",
    database: SEEDED.warehouseDbId,
    native: { query: ORDERS_BY_STATUS_SQL },
  };
}

// A server that drops the compiled query's collection from every answer cannot say whether it has
// one.
function compiledCollection(): Pick<CompiledQuery, "collection"> {
  return serverHas("compiledQueryOmitsCollection") ? { collection: null } : {};
}

describe("query e2e", () => {
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

  it("--print-schema emits the schema bundle with all 4 common defs", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--print-schema"],
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, QuerySchemaBundle)).toEqual(getQuerySchemaBundle());
  });

  it("--dry-run with a valid numeric-IDs body returns ok and exits 0", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify(VALID_QUERY),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({ ok: true, errors: [] });
  });

  it("--dry-run rejects string-id / FK-tuple bodies (only positive integers are accepted)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify(STRING_FK_BODY),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [
        { path: "/database", message: "must be integer" },
        { path: "/stages/0/source-table", message: "must be integer" },
      ],
    });
    expect(result.stderr).toContain("validation failed: 2 error(s)");
  });

  it("--dry-run with an empty stages array reports the structural error and exits 2", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify(EMPTY_STAGES_QUERY),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain("validation failed: 1 error(s)");
  });

  it("run (no --dry-run) with an invalid body refuses to send and points at --skip-validate", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query"],
      stdin: JSON.stringify(EMPTY_STAGES_QUERY),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain(
      "validation failed: 1 error(s) — fix them, or pass --skip-validate to send anyway",
    );
  });

  it("--dry-run with malformed JSON exits 2 with a ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: "not json",
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("request body: invalid JSON:");
    expect(result.stdout).toBe("");
  });

  it("--skip-validate combined with --dry-run is rejected with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--skip-validate", "--dry-run"],
      stdin: JSON.stringify(VALID_QUERY),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--skip-validate cannot be combined with --dry-run");
    expect(result.stdout).toBe("");
  });

  it("--skip-validate sends an invalid body and surfaces the server-side error (HttpError, exit 1)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--skip-validate", "--json"],
      stdin: JSON.stringify(STRING_FK_BODY),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(QUERY_NORMALIZATION_MESSAGE);
    expect(result.stdout).toBe("");
  });

  it("run executes a valid MBQL 5 query against /api/dataset and returns rows", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json"],
      stdin: JSON.stringify({
        "lib/type": "mbql/query",
        database: SEEDED.warehouseDbId,
        stages: [
          {
            "lib/type": "mbql.stage/mbql",
            "source-table": SEEDED.tables.orders,
            limit: 3,
          },
        ],
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const queryResult = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(queryResult);
    expect(queryResult.row_count).toBe(3);
    expect(queryResult.data.rows).toHaveLength(3);
  });

  it("run with a legacy native body skips MBQL 5 pre-flight and executes against /api/dataset", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json"],
      stdin: JSON.stringify({
        type: "native",
        database: SEEDED.warehouseDbId,
        native: { query: "SELECT 1 AS one, 2 AS two" },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const queryResult = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(queryResult);
    expect(queryResult.row_count).toBe(1);
    expect(queryResult.data.rows).toEqual([[1, 2]]);
  });

  it("run (json) returns the compact projection: deterministic rows, no envelope metadata", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json"],
      stdin: JSON.stringify({
        type: "native",
        database: SEEDED.warehouseDbId,
        native: { query: "SELECT 1 AS one, 2 AS two" },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const printed = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(printed);
    assertCompactColumns(printed);
    expect(printed).not.toHaveProperty("json_query");
    expect(printed.data).not.toHaveProperty("results_metadata");

    const compact = parseJson(result.stdout, CardQueryResultCompact);
    expect({
      status: compact.status,
      row_count: compact.row_count,
      rows: compact.data?.rows,
      colNames: compact.data?.cols.map((column) => column.name),
    }).toEqual({
      status: "completed",
      row_count: 1,
      rows: [[1, 2]],
      colNames: ["one", "two"],
    });
  });

  it("run --json --full returns the raw envelope with json_query and results_metadata", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json", "--full"],
      stdin: JSON.stringify({
        type: "native",
        database: SEEDED.warehouseDbId,
        native: { query: "SELECT 1 AS one, 2 AS two" },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const printed = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(printed);
    expect(printed).toHaveProperty("json_query");
    expect(printed.data).toHaveProperty("results_metadata");
  });

  it("--dry-run with a legacy native body returns ok and exits 0 (no schema applies)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify({
        type: "native",
        database: SEEDED.warehouseDbId,
        native: { query: "SELECT 1" },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({ ok: true, errors: [] });
  });

  it("run with a legacy MBQL 4 body skips MBQL 5 pre-flight and executes against /api/dataset (parity with card create)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json"],
      stdin: JSON.stringify({
        type: "query",
        database: SEEDED.warehouseDbId,
        query: {
          "source-table": SEEDED.tables.orders,
          limit: 3,
        },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const queryResult = parseJson(result.stdout, CardQueryResult);
    assertCompletedQuery(queryResult);
    expect(queryResult.row_count).toBe(3);
    expect(queryResult.data.rows).toHaveLength(3);
  });

  it("--dry-run with a legacy MBQL 4 body returns ok and exits 0 (server normalizes; no MBQL 5 schema applies)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify({
        type: "query",
        database: SEEDED.warehouseDbId,
        query: { "source-table": SEEDED.tables.orders, limit: 1 },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({ ok: true, errors: [] });
  });

  it('rejects the double-wrap footgun (MBQL 5 inside a legacy {type:"query"} envelope) with a ConfigError', async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify({
        type: "query",
        database: SEEDED.warehouseDbId,
        query: {
          "lib/type": "mbql/query",
          database: SEEDED.warehouseDbId,
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": SEEDED.tables.orders }],
        },
      }),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'query: the body is the query itself: {"lib/type": "mbql/query", "database": N, "stages": […]}.',
    );
    expect(result.stdout).toBe("");
  });

  it("--compile prints the compiled SQL prettified, as the server defaults to", async () => {
    const result = await runCli({
      args: ["query", "--compile", "--json"],
      stdin: JSON.stringify(ordersQuery()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const compiled = parseJson(result.stdout, CompiledQuery);
    expect(compiled).toEqual({
      query: expect.stringContaining('FROM\n  "public"."orders"'),
      params: null,
      ...compiledCollection(),
    });
  });

  it("--compile --no-pretty prints the compiled SQL on one line", async () => {
    const result = await runCli({
      args: ["query", "--compile", "--no-pretty", "--json"],
      stdin: JSON.stringify(ordersQuery()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const compiled = parseJson(result.stdout, CompiledQuery);
    expect(compiled).toEqual({
      query: expect.stringContaining(' FROM "public"."orders"'),
      params: null,
      ...compiledCollection(),
    });
    expect(compiled.query).not.toContain("\n");
  });

  it("--compile in text mode prints the bare SQL so it composes in a shell", async () => {
    const result = await runCli({
      args: ["query", "--compile", "--no-pretty", "--format", "text"],
      stdin: JSON.stringify(ordersCountQuery()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.startsWith("SELECT ")).toBe(true);
    expect(result.stdout.endsWith(' FROM "public"."orders"')).toBe(true);
  });

  it("--compile still pre-flights an MBQL 5 body and refuses to send an invalid one", async () => {
    const result = await runCli({
      args: ["query", "--compile"],
      stdin: JSON.stringify(EMPTY_STAGES_QUERY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
    expect(result.stderr).toContain(
      "validation failed: 1 error(s) — fix them, or pass --skip-validate to send anyway",
    );
  });

  it("--compile refuses a body that is not a query before any request", async () => {
    const result = await runCli({
      args: ["query", "--compile"],
      stdin: "{}",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'dataset_query must include "lib/type" (MBQL 5) or "type" (legacy MBQL/native); empty `{}` is rejected',
    );
    expect(result.stdout).toBe("");
  });

  it("--metadata lists the source table and its FK target, compact by default", async () => {
    const result = await runCli({
      args: ["query", "--metadata", "--json"],
      stdin: JSON.stringify(ordersQuery()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const metadata = parseJson(result.stdout, QueryMetadataCompact);
    expect({
      databases: metadata.databases.map((database) => database.name),
      tables: metadata.tables.map((table) => table.display_name).toSorted(),
      tableIds: metadata.tables.map((table) => table.id).toSorted(),
      fields: metadata.fields,
      snippets: metadata.snippets,
    }).toEqual({
      databases: ["Warehouse"],
      tables: ["Customers", "Orders"],
      tableIds: [SEEDED.tables.customers, SEEDED.tables.orders].toSorted(),
      fields: [],
      snippets: [],
    });
  });

  it("--metadata in text mode prints one line of names per kind", async () => {
    const result = await runCli({
      args: ["query", "--metadata", "--format", "text"],
      stdin: JSON.stringify(ordersQuery()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      ["Databases  Warehouse", "Tables     Customers, Orders", "Fields     ", "Snippets   "].join(
        "\n",
      ),
    );
  });

  it("--export-format csv streams a CSV with the header row and one line per group", async () => {
    const result = await runCli({
      args: ["query", "--export-format", "csv"],
      stdin: JSON.stringify(ordersByStatusNative()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("status,n");
    expect(lines.length).toBe(ORDERS_STATUS_COUNT + 1);
  });

  it("--export-format xlsx streams an XLSX file (zip magic bytes)", async () => {
    const result = await runCli({
      args: ["query", "--export-format", "xlsx"],
      stdin: JSON.stringify(ordersByStatusNative()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.slice(0, 4)).toBe("\x50\x4b\x03\x04");
  });

  it("--export-format with an invalid value fails with ConfigError", async () => {
    const result = await runCli({
      args: ["query", "--export-format", "html"],
      stdin: JSON.stringify(ordersByStatusNative()),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --export-format: "html" (expected one of: csv, json, xlsx)',
    );
    expect(result.stdout).toBe("");
  });

  it("refuses two mode flags naming both, before reading the body", async () => {
    const result = await runCli({
      args: ["query", "--dry-run", "--compile", "--export-format", "csv"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "--dry-run cannot be combined with --compile, --export-format",
    );
    expect(result.stdout).toBe("");
  });

  it("refuses --no-pretty outside --compile", async () => {
    const result = await runCli({
      args: ["query", "--metadata", "--no-pretty"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("--no-pretty requires --compile");
    expect(result.stdout).toBe("");
  });

  it("refuses an export-only flag without --export-format", async () => {
    const result = await runCli({
      args: ["query", "--format-rows"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("--format-rows requires --export-format");
    expect(result.stdout).toBe("");
  });
});

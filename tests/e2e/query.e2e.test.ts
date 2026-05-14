import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  getQuerySchemaBundle,
  QuerySchemaBundle,
  ValidationOutcome,
} from "../../src/core/schema/validate";
import { CardQueryResult } from "../../src/domain/card";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES, E2E_TABLES } from "./seed/ids";

const VALID_QUERY = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": 7,
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
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
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
    expect(result.stderr).toContain("validation failed: 3 error(s)");
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

  it("run (no --dry-run) with an invalid body refuses to send and points at --dry-run", async () => {
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
      "validation failed: 1 error(s) — pass --dry-run to validate without sending",
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
    expect(result.stderr).toContain('database: should be an integer, received: "My DB"');
    expect(result.stdout).toBe("");
  });

  it("run executes a valid MBQL 5 query against /api/dataset and returns rows", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json"],
      stdin: JSON.stringify({
        "lib/type": "mbql/query",
        database: E2E_DATABASES.WAREHOUSE,
        stages: [
          {
            "lib/type": "mbql.stage/mbql",
            "source-table": E2E_TABLES.ORDERS,
            limit: 3,
          },
        ],
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const queryResult = parseJson(result.stdout, CardQueryResult);
    expect(queryResult.status).toBe("completed");
    if (queryResult.status === "completed") {
      expect(queryResult.row_count).toBe(3);
      expect(queryResult.data.rows).toHaveLength(3);
    }
  });

  it("run with a legacy native body skips MBQL 5 pre-flight and executes against /api/dataset", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--json"],
      stdin: JSON.stringify({
        type: "native",
        database: E2E_DATABASES.WAREHOUSE,
        native: { query: "SELECT 1 AS one, 2 AS two" },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const queryResult = parseJson(result.stdout, CardQueryResult);
    expect(queryResult.status).toBe("completed");
    if (queryResult.status === "completed") {
      expect(queryResult.row_count).toBe(1);
      expect(queryResult.data.rows).toEqual([[1, 2]]);
    }
  });

  it("--dry-run with a legacy native body returns ok and exits 0 (no schema applies)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify({
        type: "native",
        database: E2E_DATABASES.WAREHOUSE,
        native: { query: "SELECT 1" },
      }),
      configHome,
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
        database: E2E_DATABASES.WAREHOUSE,
        query: {
          "source-table": E2E_TABLES.ORDERS,
          limit: 3,
        },
      }),
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const queryResult = parseJson(result.stdout, CardQueryResult);
    expect(queryResult.status).toBe("completed");
    if (queryResult.status === "completed") {
      expect(queryResult.row_count).toBe(3);
      expect(queryResult.data.rows).toHaveLength(3);
    }
  });

  it("--dry-run with a legacy MBQL 4 body returns ok and exits 0 (server normalizes; no MBQL 5 schema applies)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["query", "--dry-run"],
      stdin: JSON.stringify({
        type: "query",
        database: E2E_DATABASES.WAREHOUSE,
        query: { "source-table": E2E_TABLES.ORDERS, limit: 1 },
      }),
      configHome,
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
        database: E2E_DATABASES.WAREHOUSE,
        query: {
          "lib/type": "mbql/query",
          database: E2E_DATABASES.WAREHOUSE,
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": E2E_TABLES.ORDERS }],
        },
      }),
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'query: MBQL 5 query nested inside a legacy {type:"query", query:…} envelope.',
    );
    expect(result.stdout).toBe("");
  });
});

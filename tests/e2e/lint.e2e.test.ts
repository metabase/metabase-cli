import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Card, CardCompact, type CardCreateInput } from "@metabase/client/domain/card";
import { LintReport } from "@metabase/client/domain/lint";
import { parseJson } from "@metabase/client/json";

import { readBootstrap, type E2EBootstrap, type ServerIdentity } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requirementFailure, requireServer, requireServerWithout } from "./server-gate";

const DEPENDENCIES_REFUSAL =
  "This operation requires the 'dependencies' premium feature (not enabled on this server).";
const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";
const FORBIDDEN_MESSAGE = "You don't have permissions to do that.";
const MODEL_NAME = "Lint model";
const DEPENDENT_NAME = "Lint dependent";
const NATIVE_NAME = "Lint native";
// A column the orders table has and the products table does not, so pointing the model at products
// breaks a dependent that reads it.
const ORDERS_ONLY_COLUMN = "total_cents";
// A table no schema of the warehouse holds, so the parser resolves it to nothing.
const UNKNOWN_TABLE = "orderz";

const PASSED_REPORT = {
  status: "passed",
  summary: { errors: 0, warnings: 0, entities: 0 },
  entities: {},
  rules: {},
  results: [],
};

const MISSING_COLUMN_RULE = {
  severity: "error",
  description: "A query reads a column its source does not have.",
};
const MISSING_TABLE_ALIAS_RULE = {
  severity: "error",
  description: "Native SQL reads a table no known table matches.",
};

const skipReason = requireServer("lint › lint e2e against the EE lint endpoint", ["lintReport"]);
const unsupportedSkipReason = requireServerWithout("lint › server without the lint endpoint", [
  "lintReport",
]);
const lintGap = requirementFailure(["lintReport"]);

// The explained refusal names the version gap before the missing token feature.
function liveRefusal(server: ServerIdentity): string {
  if (lintGap?.reason !== "version-too-old") {
    return DEPENDENCIES_REFUSAL;
  }
  if (server.version === null) {
    throw new Error("a server with no parsed version is placed past the window, never below it");
  }
  return `This operation requires Metabase v66+ (this server is ${server.version.tag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`;
}

function tableQuery(tableId: number) {
  return {
    "lib/type": "mbql/query",
    database: SEEDED.warehouseDbId,
    stages: [{ "lib/type": "mbql.stage/mbql", "source-table": tableId }],
  };
}

interface IdentifiedCard {
  id: number;
  entity_id: string;
}

interface BrokenDependent {
  model: IdentifiedCard;
  dependent: IdentifiedCard;
}

type LintCardInput = Pick<CardCreateInput, "name" | "type" | "dataset_query">;

describe.skipIf(skipReason !== null)("lint e2e", () => {
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

  function authEnv(apiKey = bootstrap.adminApiKey) {
    return { MB_URL: bootstrap.baseUrl, MB_API_KEY: apiKey };
  }

  async function runLint(...args: string[]) {
    return runCli({
      args: ["lint", ...args],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
  }

  async function createCard(body: LintCardInput): Promise<IdentifiedCard> {
    const created = await runCli({
      args: ["card", "create", "--json"],
      stdin: JSON.stringify({
        display: "table",
        visualization_settings: {},
        collection_id: SEEDED.defaultCollectionId,
        ...body,
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(created.exitCode, created.stderr).toBe(0);
    const { id } = parseJson(created.stdout, CardCompact);
    const fetched = await runCli({
      args: ["card", "get", String(id), "--json", "--full"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(fetched.exitCode, fetched.stderr).toBe(0);
    const { entity_id } = parseJson(fetched.stdout, Card);
    if (entity_id === null) {
      throw new Error(`card ${id} has no entity_id`);
    }
    return { id, entity_id };
  }

  // A model of the orders table and a question that filters on a column only orders has, then the
  // model pointed at products: the question is broken, and the model is the cause.
  async function breakDependentOfModel(): Promise<BrokenDependent> {
    const model = await createCard({
      name: MODEL_NAME,
      type: "model",
      dataset_query: tableQuery(SEEDED.tables.orders),
    });
    const dependent = await createCard({
      name: DEPENDENT_NAME,
      dataset_query: {
        "lib/type": "mbql/query",
        database: SEEDED.warehouseDbId,
        stages: [
          {
            "lib/type": "mbql.stage/mbql",
            "source-card": model.id,
            filters: [
              [">", {}, ["field", { "base-type": "type/BigInteger" }, ORDERS_ONLY_COLUMN], 100],
            ],
          },
        ],
      },
    });
    const broken = await runCli({
      args: ["card", "update", String(model.id), "--json"],
      stdin: JSON.stringify({ dataset_query: tableQuery(SEEDED.tables.products) }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(broken.exitCode, broken.stderr).toBe(0);
    return { model, dependent };
  }

  it("passes with an empty report on the restored snapshot", async () => {
    const result = await runLint("--json");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, LintReport)).toEqual(PASSED_REPORT);
  });

  it("fails on a question its model no longer satisfies, naming the model as the cause", async () => {
    const { model, dependent } = await breakDependentOfModel();

    const result = await runLint("--json");

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("failed");
    expect(cliErrorMessage(result.stderr)).toBe("lint failed: 1 error(s)");
    expect(parseJson(result.stdout, LintReport)).toEqual({
      status: "failed",
      summary: { errors: 1, warnings: 0, entities: 1 },
      entities: {
        [dependent.entity_id]: {
          id: dependent.id,
          type: "card",
          data: { name: DEPENDENT_NAME, collection_id: SEEDED.defaultCollectionId },
        },
      },
      rules: { "missing-column": MISSING_COLUMN_RULE },
      results: [
        {
          ruleId: "missing-column",
          entity_id: dependent.entity_id,
          message: `Column ${ORDERS_ONLY_COLUMN} is not on card "${MODEL_NAME}"`,
          detail: ORDERS_ONLY_COLUMN,
          cause: { type: "card", id: model.id, entity_id: model.entity_id, name: MODEL_NAME },
        },
      ],
    });
  });

  it("fails on native SQL reading an unknown table, with no cause to trace it to", async () => {
    const native = await createCard({
      name: NATIVE_NAME,
      dataset_query: {
        "lib/type": "mbql/query",
        database: SEEDED.warehouseDbId,
        stages: [{ "lib/type": "mbql.stage/native", native: `SELECT * FROM ${UNKNOWN_TABLE}` }],
      },
    });

    const result = await runLint("--json");

    expect(result.exitCode).toBe(1);
    expect(parseJson(result.stdout, LintReport)).toEqual({
      status: "failed",
      summary: { errors: 1, warnings: 0, entities: 1 },
      entities: {
        [native.entity_id]: {
          id: native.id,
          type: "card",
          data: { name: NATIVE_NAME, collection_id: SEEDED.defaultCollectionId },
        },
      },
      rules: { "missing-table-alias": MISSING_TABLE_ALIAS_RULE },
      results: [
        {
          ruleId: "missing-table-alias",
          entity_id: native.entity_id,
          message: `Native SQL reads ${UNKNOWN_TABLE}, which no known table matches`,
          detail: UNKNOWN_TABLE,
          cause: null,
        },
      ],
    });
  });

  it("writes the report as text for a terminal, grouped by entity", async () => {
    const { dependent } = await breakDependentOfModel();

    const result = await runLint("--format", "text");

    expect(result.exitCode).toBe(1);
    // execa strips the final newline from stdout.
    expect(result.stdout).toBe(
      [
        `✗ card "${DEPENDENT_NAME}" ${dependent.entity_id}`,
        `    missing-column  Column ${ORDERS_ONLY_COLUMN} is not on card "${MODEL_NAME}"`,
        "FAILED  1 error in 1 entity",
      ].join("\n"),
    );
  });

  it("withholds a failed report over --max-bytes and still exits 1", async () => {
    await breakDependentOfModel();

    const result = await runLint("--json", "--max-bytes", "10");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(cliErrorCategory(result.stderr)).toBe("failed");
    expect(cliErrorMessage(result.stderr)).toContain(
      "over the 10-byte --max-bytes cap; narrow with --fields or raise the cap with --max-bytes <n>",
    );
  });

  it("narrows the report to the fields asked for", async () => {
    await breakDependentOfModel();

    const result = await runLint("--json", "--fields", "status,summary");

    expect(result.exitCode).toBe(1);
    expect(parseJson(result.stdout, LintReport.pick({ status: true, summary: true }))).toEqual({
      status: "failed",
      summary: { errors: 1, warnings: 0, entities: 1 },
    });
  });

  it("is refused for a key that is not an admin's", async () => {
    const result = await runCli({
      args: ["lint", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(bootstrap.limitedApiKey),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(cliErrorMessage(result.stderr)).toContain(FORBIDDEN_MESSAGE);
  });
});

describe.skipIf(unsupportedSkipReason !== null)("lint e2e on a server without the endpoint", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  it("explains the refusal with the server's own answer and exits 2", async () => {
    const configHome = await mkTempConfigHome();
    tempDirs.push(configHome);

    const result = await runCli({
      args: ["lint", "--json"],
      configHome,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal(bootstrap.server));
  });
});

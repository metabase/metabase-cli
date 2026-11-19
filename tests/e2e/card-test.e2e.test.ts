import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DATA_TEST_SCHEMAS,
  DataTestCompact,
  DataTestRunResult,
  DataTestWithNowCompact,
} from "@metabase/client/domain/data-test";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { TestListEnvelope } from "../../packages/cli/src/commands/test/list";
import { TestRunListEnvelope } from "../../packages/cli/src/commands/test/runs";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { type RunCliResult, cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const skipReason = requireServer("test › card tests", [
  "cardTests",
  "dataTestRuns",
  "dataTestFixedClock",
]);

const Created = z.object({ id: z.number().int() });

const CARD_BODY = {
  name: "Order totals",
  display: "table",
  visualization_settings: {},
  collection_id: SEEDED.defaultCollectionId,
  dataset_query: {
    type: "native",
    database: SEEDED.warehouseDbId,
    native: { query: "SELECT id, subtotal_cents + tax_cents AS total_cents FROM orders" },
  },
};

const COUNT_CARD_BODY = {
  name: "Order count",
  display: "scalar",
  visualization_settings: {},
  collection_id: SEEDED.defaultCollectionId,
  dataset_query: {
    "lib/type": "mbql/query",
    database: SEEDED.warehouseDbId,
    stages: [
      {
        "lib/type": "mbql.stage/mbql",
        "source-table": SEEDED.tables.orders,
        aggregation: [["count", {}]],
      },
    ],
  },
};

const COUNT_TEST_BODY = {
  name: "counts every order",
  inputs: [
    {
      table: { schema: "public", name: "orders" },
      format: "rows",
      columns: [{ name: "id", cast_type: "INTEGER" }],
      rows: [{ id: 1 }],
    },
  ],
  expectations: [
    { type: "empty", name: "no negative count", sql: "SELECT * FROM {{output}} WHERE count < 0" },
  ],
};

const FIXED_NOW = "2026-10-13T00:00:00Z";

const INPUTS = [
  {
    table: { schema: "public", name: "orders" },
    format: "rows",
    columns: [
      { name: "id", cast_type: "INTEGER" },
      { name: "subtotal_cents", cast_type: "BIGINT" },
      { name: "tax_cents", cast_type: "BIGINT" },
    ],
    rows: [{ id: 1, subtotal_cents: 100, tax_cents: 10 }],
  },
];

const EXPECTATIONS = [
  {
    type: "empty",
    name: "no negative totals",
    sql: "SELECT * FROM {{output}} WHERE total_cents < 0",
  },
];

describe.skipIf(skipReason !== null)("test e2e, card tests", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function mb(args: string[], stdin?: string): Promise<RunCliResult> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return runCli({
      args,
      configHome: dir,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      ...(stdin === undefined ? {} : { stdin }),
    });
  }

  async function createCard(
    body: typeof CARD_BODY | typeof COUNT_CARD_BODY = CARD_BODY,
  ): Promise<number> {
    const card = await mb(["card", "create", "--json"], JSON.stringify(body));
    expect(card.exitCode, card.stderr).toBe(0);
    return parseJson(card.stdout, Created).id;
  }

  async function createCardTest(cardId: number): Promise<number> {
    const test = await mb(
      ["test", "create", "--id", `card:${cardId}`, "--json"],
      JSON.stringify({
        name: "totals are never negative",
        inputs: INPUTS,
        expectations: EXPECTATIONS,
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    return parseJson(test.stdout, Created).id;
  }

  it("creates a card test and lists it under its card", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const list = await mb(["test", "list", "--id", `card:${cardId}`, "--json"]);

    expect(list.exitCode, list.stderr).toBe(0);
    expect(parseJson(list.stdout, TestListEnvelope)).toEqual({
      data: [
        {
          test_type: "card",
          id: testId,
          target_id: cardId,
          name: "totals are never negative",
          description: null,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("gets a card test in full, with its inputs, its expectations and no run yet", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const get = await mb(["test", "get", "--id", `card-test:${testId}`, "--full", "--json"]);

    expect(get.exitCode, get.stderr).toBe(0);
    expect(parseJson(get.stdout, DATA_TEST_SCHEMAS.card)).toEqual({
      id: testId,
      entity_id: expect.any(String),
      card_id: cardId,
      creator_id: expect.any(Number),
      name: "totals are never negative",
      description: null,
      now: null,
      inputs: INPUTS,
      expectations: EXPECTATIONS,
      created_at: expect.any(String),
      updated_at: expect.any(String),
      last_run: null,
    });
  });

  it("saves the fixed clock of a test of a card built without SQL, and shows it in get", async () => {
    const cardId = await createCard(COUNT_CARD_BODY);
    const created = await mb(
      ["test", "create", "--id", `card:${cardId}`, "--json"],
      JSON.stringify({ ...COUNT_TEST_BODY, now: FIXED_NOW }),
    );
    expect(created.exitCode, created.stderr).toBe(0);
    const testId = parseJson(created.stdout, Created).id;

    const get = await mb(["test", "get", "--id", `card-test:${testId}`, "--json"]);

    expect(get.exitCode, get.stderr).toBe(0);
    expect(parseJson(get.stdout, DataTestWithNowCompact)).toEqual({
      id: testId,
      name: "counts every order",
      description: null,
      now: FIXED_NOW,
    });
  });

  it("puts a test back on the real clock when an update sends a null `now`", async () => {
    const cardId = await createCard(COUNT_CARD_BODY);
    const created = await mb(
      ["test", "create", "--id", `card:${cardId}`, "--json"],
      JSON.stringify({ ...COUNT_TEST_BODY, now: FIXED_NOW }),
    );
    expect(created.exitCode, created.stderr).toBe(0);
    const testId = parseJson(created.stdout, Created).id;

    const update = await mb(
      ["test", "update", "--id", `card-test:${testId}`, "--json"],
      JSON.stringify({ now: null }),
    );

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, DataTestWithNowCompact)).toEqual({
      id: testId,
      name: "counts every order",
      description: null,
      now: null,
    });
  });

  it("passes on the server's refusal of `now` on a card written in SQL", async () => {
    const cardId = await createCard();

    const created = await mb(
      ["test", "create", "--id", `card:${cardId}`, "--json"],
      JSON.stringify({
        name: "totals are never negative",
        now: FIXED_NOW,
        inputs: INPUTS,
        expectations: EXPECTATIONS,
      }),
    );

    expect(created.exitCode).toBe(1);
    expect(cliErrorMessage(created.stderr)).toContain(
      "This test cannot set `now`: its query is written in SQL, or built on a question written in SQL",
    );
  });

  it("updates only the fields the body carries", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const update = await mb(
      ["test", "update", "--id", `card-test:${testId}`, "--json"],
      JSON.stringify({ name: "renamed", description: "pins the sign of the total" }),
    );

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, DataTestCompact)).toEqual({
      id: testId,
      name: "renamed",
      description: "pins the sign of the total",
    });
  });

  it("runs a card test against its fixtures, and lists the run in the test's history", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const run = await mb(["test", "run", "--id", `card-test:${testId}`, "--json"]);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(parseJson(run.stdout, DataTestRunResult)).toEqual({
      status: "passed",
      expectations: [{ name: "no negative totals", type: "empty", status: "passed" }],
      tables: expect.any(Object),
    });

    const runs = await mb(["test", "runs", "--id", `card-test:${testId}`, "--json"]);

    expect(runs.exitCode, runs.stderr).toBe(0);
    expect(parseJson(runs.stdout, TestRunListEnvelope)).toEqual({
      data: [
        {
          id: expect.any(Number),
          test_type: "card",
          test_id: testId,
          initiated_by: expect.any(Number),
          start_time: expect.any(String),
          end_time: expect.any(String),
          status: "passed",
        },
      ],
      returned: 1,
      offset: 0,
      limit: 20,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("exits 1 when an expectation fails, naming the test", async () => {
    const cardId = await createCard();
    const test = await mb(
      ["test", "create", "--id", `card:${cardId}`, "--json"],
      JSON.stringify({
        name: "no order at all",
        inputs: INPUTS,
        expectations: [{ type: "empty", name: "no rows", sql: "SELECT * FROM {{output}}" }],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = parseJson(test.stdout, Created).id;

    const run = await mb(["test", "run", "--id", `card-test:${testId}`]);

    expect(run.exitCode).toBe(1);
    expect(cliErrorMessage(run.stderr)).toBe(`card-test:${testId} failed`);
  });

  it("deletes a card test, after which it is not found", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const deleted = await mb(["test", "delete", "--id", `card-test:${testId}`, "--yes", "--json"]);

    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: testId,
    });

    const get = await mb(["test", "get", "--id", `card-test:${testId}`, "--json"]);

    expect(get.exitCode).toBe(1);
    expect(cliErrorMessage(get.stderr)).toBe(`Not found: GET /api/ee/card-test/${testId}.`);
  });
});

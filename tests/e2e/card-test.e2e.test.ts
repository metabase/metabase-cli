import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DATA_TEST_SCHEMAS,
  DataTestCompact,
  type DataTestRunCompact,
  DataTestRunDetailCompact,
  DataTestRunResult,
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

const skipReason = requireServer("test › card tests", ["cardTests", "dataTestRuns"]);

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

  async function createCard(): Promise<number> {
    const card = await mb(["card", "create", "--json"], JSON.stringify(CARD_BODY));
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

  async function runFailingCardTest(): Promise<DataTestRunCompact> {
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
    const runs = await mb(["test", "runs", "--id", `card-test:${testId}`, "--json"]);
    expect(runs.exitCode, runs.stderr).toBe(0);
    const [listed] = parseJson(runs.stdout, TestRunListEnvelope).data;
    assert(listed !== undefined, "expected the run in the test's history");
    return listed;
  }

  it("gets a failed run by its run id, with the result it stored", async () => {
    const listed = await runFailingCardTest();

    const got = await mb(["test", "get-run", String(listed.id), "--json"]);

    expect(got.exitCode, got.stderr).toBe(0);
    const detail = parseJson(got.stdout, DataTestRunDetailCompact);
    expect(detail).toEqual({
      ...listed,
      result: {
        status: "failed",
        expectations: [
          {
            name: "no rows",
            type: "empty",
            status: "failed",
            columns: [
              { name: "id", database_type: "int4" },
              { name: "total_cents", database_type: "int8" },
            ],
            sample: [{ id: 1, total_cents: 110 }],
            truncated: 0,
          },
        ],
        tables: expect.any(Object),
      },
      can_read_result: true,
    });
    expect(Object.values(DataTestRunResult.parse(detail.result).tables).toSorted()).toEqual([
      "Order totals",
      "public.orders",
    ]);
  });

  it("summarizes the stored result of a run under --format text", async () => {
    const listed = await runFailingCardTest();

    const got = await mb(["test", "get-run", String(listed.id), "--format", "text"]);

    expect(got.exitCode, got.stderr).toBe(0);
    expect(got.stdout).toBe(
      [
        `ID       ${listed.id}`,
        `Test     ${listed.test_id}`,
        "Status   failed",
        `Started  ${listed.start_time}`,
        `Ended    ${listed.end_time}`,
        `Result   card-test:${listed.test_id} failed — failed: no rows.`,
      ].join("\n"),
    );
  });

  it("exits 2 on a run id that is not an integer", async () => {
    const got = await mb(["test", "get-run", "abc"]);

    expect(got.exitCode).toBe(2);
    expect(cliErrorMessage(got.stderr)).toBe('invalid run id: "abc" (expected integer)');
    expect(got.stdout).toBe("");
  });

  it("exits 1 on a run id the server does not hold", async () => {
    const got = await mb(["test", "get-run", "9999999"]);

    expect(got.exitCode).toBe(1);
    expect(cliErrorMessage(got.stderr)).toBe("Not found: GET /api/ee/data-test-run/9999999.");
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

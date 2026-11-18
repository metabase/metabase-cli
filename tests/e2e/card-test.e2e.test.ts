import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { CardTest, CardTestCompact } from "@metabase/client/domain/card-test";
import { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { CardTestListEnvelope } from "../../packages/cli/src/commands/card-test/list";
import { CardTestRunListEnvelope } from "../../packages/cli/src/commands/card-test/runs";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { type RunCliResult, cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const skipReason = requireServer("card-test › card test e2e", ["cardTests", "dataTestRuns"]);

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

describe.skipIf(skipReason !== null)("card test e2e", () => {
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
      ["card-test", "create", "--json"],
      JSON.stringify({
        card_id: cardId,
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

    const list = await mb(["card-test", "list", "--card-id", String(cardId), "--json"]);

    expect(list.exitCode, list.stderr).toBe(0);
    expect(parseJson(list.stdout, CardTestListEnvelope)).toEqual({
      data: [{ id: testId, card_id: cardId, name: "totals are never negative", description: null }],
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

    const get = await mb(["card-test", "get", String(testId), "--full", "--json"]);

    expect(get.exitCode, get.stderr).toBe(0);
    expect(parseJson(get.stdout, CardTest)).toEqual({
      id: testId,
      entity_id: expect.any(String),
      card_id: cardId,
      creator_id: expect.any(Number),
      name: "totals are never negative",
      description: null,
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
      ["card-test", "update", String(testId), "--json"],
      JSON.stringify({ name: "renamed", description: "pins the sign of the total" }),
    );

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, CardTestCompact)).toEqual({
      id: testId,
      card_id: cardId,
      name: "renamed",
      description: "pins the sign of the total",
    });
  });

  it("runs a card test against its fixtures, and lists the run in the test's history", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const run = await mb(["card-test", "run", String(testId), "--json"]);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(parseJson(run.stdout, TransformTestRunResult)).toEqual({
      status: "passed",
      expectations: [{ name: "no negative totals", type: "empty", status: "passed" }],
      tables: expect.any(Object),
    });

    const runs = await mb(["card-test", "runs", "--test-id", String(testId), "--json"]);

    expect(runs.exitCode, runs.stderr).toBe(0);
    expect(parseJson(runs.stdout, CardTestRunListEnvelope)).toEqual({
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

  it("exits 1 when an expectation fails, naming it", async () => {
    const cardId = await createCard();
    const test = await mb(
      ["card-test", "create", "--json"],
      JSON.stringify({
        card_id: cardId,
        name: "no order at all",
        inputs: INPUTS,
        expectations: [{ type: "empty", name: "no rows", sql: "SELECT * FROM {{output}}" }],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = parseJson(test.stdout, Created).id;

    const run = await mb(["card-test", "run", String(testId)]);

    expect(run.exitCode).toBe(1);
    expect(cliErrorMessage(run.stderr)).toBe(`card test ${testId} failed`);
  });

  it("deletes a card test, after which it is not found", async () => {
    const cardId = await createCard();
    const testId = await createCardTest(cardId);

    const deleted = await mb(["card-test", "delete", String(testId), "--yes", "--json"]);

    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: testId,
    });

    const get = await mb(["card-test", "get", String(testId), "--json"]);

    expect(get.exitCode).toBe(1);
    expect(cliErrorMessage(get.stderr)).toBe(`Not found: GET /api/ee/card-test/${testId}.`);
  });
});

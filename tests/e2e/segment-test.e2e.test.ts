import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DATA_TEST_SCHEMAS,
  DataTestCompact,
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

const skipReason = requireServer("test › segment tests", ["segmentTests", "dataTestRuns"]);

const Created = z.object({ id: z.number().int() });

const SEGMENT_BODY = {
  name: "Positive id orders",
  table_id: SEEDED.tables.orders,
  definition: {
    database: SEEDED.warehouseDbId,
    type: "query",
    query: {
      "source-table": SEEDED.tables.orders,
      filter: [">", ["field", SEEDED.fields.ordersId, null], 0],
    },
  },
};

const INPUTS = [
  {
    table: { schema: "public", name: "orders" },
    format: "rows",
    columns: [{ name: "id", cast_type: "INTEGER" }],
    rows: [{ id: 1 }, { id: 0 }],
  },
];

const EXPECTATIONS = [
  {
    type: "empty",
    name: "no order without a positive id",
    sql: "SELECT * FROM {{output}} WHERE id <= 0",
  },
];

describe.skipIf(skipReason !== null)("test e2e, segment tests", () => {
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

  async function createSegment(): Promise<number> {
    const segment = await mb(["segment", "create", "--json"], JSON.stringify(SEGMENT_BODY));
    expect(segment.exitCode, segment.stderr).toBe(0);
    return parseJson(segment.stdout, Created).id;
  }

  async function createSegmentTest(segmentId: number): Promise<number> {
    const test = await mb(
      ["test", "create", "--id", `segment:${segmentId}`, "--json"],
      JSON.stringify({
        name: "keeps only positive ids",
        inputs: INPUTS,
        expectations: EXPECTATIONS,
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    return parseJson(test.stdout, Created).id;
  }

  it("creates a segment test and lists it under its segment", async () => {
    const segmentId = await createSegment();
    const testId = await createSegmentTest(segmentId);

    const list = await mb(["test", "list", "--id", `segment:${segmentId}`, "--json"]);

    expect(list.exitCode, list.stderr).toBe(0);
    expect(parseJson(list.stdout, TestListEnvelope)).toEqual({
      data: [
        {
          test_type: "segment",
          id: testId,
          target_id: segmentId,
          name: "keeps only positive ids",
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

  it("gets a segment test in full, with its inputs, its expectations and no run yet", async () => {
    const segmentId = await createSegment();
    const testId = await createSegmentTest(segmentId);

    const get = await mb(["test", "get", "--id", `segment-test:${testId}`, "--full", "--json"]);

    expect(get.exitCode, get.stderr).toBe(0);
    expect(parseJson(get.stdout, DATA_TEST_SCHEMAS.segment)).toEqual({
      id: testId,
      entity_id: expect.any(String),
      segment_id: segmentId,
      creator_id: expect.any(Number),
      name: "keeps only positive ids",
      description: null,
      inputs: INPUTS,
      expectations: EXPECTATIONS,
      created_at: expect.any(String),
      updated_at: expect.any(String),
      last_run: null,
    });
  });

  it("updates only the fields the body carries", async () => {
    const segmentId = await createSegment();
    const testId = await createSegmentTest(segmentId);

    const update = await mb(
      ["test", "update", "--id", `segment-test:${testId}`, "--json"],
      JSON.stringify({ name: "renamed", description: "pins the sign of the id" }),
    );

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, DataTestCompact)).toEqual({
      id: testId,
      name: "renamed",
      description: "pins the sign of the id",
    });
  });

  it("runs a segment test against its fixtures, and lists the run in the test's history", async () => {
    const segmentId = await createSegment();
    const testId = await createSegmentTest(segmentId);

    const run = await mb(["test", "run", "--id", `segment-test:${testId}`, "--json"]);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(parseJson(run.stdout, DataTestRunResult)).toEqual({
      status: "passed",
      expectations: [{ name: "no order without a positive id", type: "empty", status: "passed" }],
      tables: expect.any(Object),
    });

    const runs = await mb(["test", "runs", "--id", `segment-test:${testId}`, "--json"]);

    expect(runs.exitCode, runs.stderr).toBe(0);
    expect(parseJson(runs.stdout, TestRunListEnvelope)).toEqual({
      data: [
        {
          id: expect.any(Number),
          test_type: "segment",
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
    const segmentId = await createSegment();
    const test = await mb(
      ["test", "create", "--id", `segment:${segmentId}`, "--json"],
      JSON.stringify({
        name: "keeps no order",
        inputs: INPUTS,
        expectations: [{ type: "empty", name: "no rows", sql: "SELECT * FROM {{output}}" }],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = parseJson(test.stdout, Created).id;

    const run = await mb(["test", "run", "--id", `segment-test:${testId}`]);

    expect(run.exitCode).toBe(1);
    expect(cliErrorMessage(run.stderr)).toBe(`segment-test:${testId} failed`);
  });

  it("deletes a segment test, after which it is not found", async () => {
    const segmentId = await createSegment();
    const testId = await createSegmentTest(segmentId);

    const deleted = await mb([
      "test",
      "delete",
      "--id",
      `segment-test:${testId}`,
      "--yes",
      "--json",
    ]);

    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: testId,
    });

    const get = await mb(["test", "get", "--id", `segment-test:${testId}`, "--json"]);

    expect(get.exitCode).toBe(1);
    expect(cliErrorMessage(get.stderr)).toBe(`Not found: GET /api/ee/segment-test/${testId}.`);
  });
});

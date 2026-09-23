import { beforeAll, describe, expect, it } from "vitest";

import {
  TransformTest,
  TransformTestCompact,
  type TransformTestCreateInput,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { TransformTestListEnvelope } from "../../packages/cli/src/commands/transform-test/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { runCli } from "./run-cli";
import { requireSeededTransform, requireServer } from "./server-gate";

const TEST_NAME = "e2e_orders_by_status_counts";
const RENAMED = "e2e_orders_by_status_counts_renamed";

const LANE = "transform-test › transform-test e2e";
const skipReason = requireServer(LANE, ["transformTests"]);
const seededTransformId = skipReason === null ? requireSeededTransform(LANE) : null;

function testBody(transformId: number): TransformTestCreateInput {
  return {
    transform_id: transformId,
    name: TEST_NAME,
    inputs: [
      {
        table: { schema: "public", name: "orders" },
        format: "rows",
        columns: [
          { name: "id", cast_type: "integer" },
          { name: "status", cast_type: "text" },
        ],
        rows: [
          { id: 1, status: "paid" },
          { id: 2, status: "paid" },
          { id: 3, status: "shipped" },
        ],
      },
    ],
    expectations: [
      {
        type: "equals",
        name: "one row per status",
        format: "rows",
        columns: [
          { name: "status", cast_type: "text" },
          { name: "n", cast_type: "bigint" },
        ],
        rows: [
          { status: "paid", n: 2 },
          { status: "shipped", n: 1 },
        ],
      },
    ],
  };
}

describe.skipIf(skipReason !== null || seededTransformId === null)("transform-test e2e", () => {
  let bootstrap: E2EBootstrap;
  let transformId: number;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    if (seededTransformId === null) {
      throw new Error("the seeded transform gate let the suite run without a transform");
    }
    transformId = seededTransformId;
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createTest(): Promise<TransformTestCompact> {
    const result = await runCli({
      args: ["transform-test", "create", "--json"],
      stdin: JSON.stringify(testBody(transformId)),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, TransformTestCompact);
    expect(created).toEqual({
      id: expect.any(Number),
      transform_id: transformId,
      name: TEST_NAME,
      description: null,
    });
    return created;
  }

  it("list is empty on the restored snapshot and lists a created test, filtered by transform", async () => {
    const before = await runCli({ args: ["transform-test", "list", "--json"], env: authEnv() });
    expect(before.exitCode, before.stderr).toBe(0);
    expect(parseJson(before.stdout, TransformTestListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });

    const created = await createTest();
    const filtered = await runCli({
      args: ["transform-test", "list", "--transform-id", String(transformId), "--json"],
      env: authEnv(),
    });
    expect(filtered.exitCode, filtered.stderr).toBe(0);
    expect(parseJson(filtered.stdout, TransformTestListEnvelope)).toEqual({
      data: [created],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("get --full returns the inputs and expectations as created", async () => {
    const created = await createTest();

    const result = await runCli({
      args: ["transform-test", "get", String(created.id), "--full", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const body = testBody(transformId);
    expect(parseJson(result.stdout, TransformTest)).toEqual(
      expect.objectContaining({
        id: created.id,
        entity_id: expect.any(String),
        transform_id: transformId,
        name: TEST_NAME,
        description: null,
        inputs: body.inputs,
        expectations: body.expectations,
      }),
    );
  });

  it("update renames the test and the change is visible via get", async () => {
    const created = await createTest();

    const updated = await runCli({
      args: ["transform-test", "update", String(created.id), "--json"],
      stdin: JSON.stringify({ name: RENAMED }),
      env: authEnv(),
    });
    expect(updated.exitCode, updated.stderr).toBe(0);
    expect(parseJson(updated.stdout, TransformTestCompact)).toEqual({ ...created, name: RENAMED });

    const fetched = await runCli({
      args: ["transform-test", "get", String(created.id), "--json"],
      env: authEnv(),
    });
    expect(fetched.exitCode, fetched.stderr).toBe(0);
    expect(parseJson(fetched.stdout, TransformTestCompact)).toEqual({ ...created, name: RENAMED });
  });

  it("run answers the passing expectation with its findings", async () => {
    const created = await createTest();

    const result = await runCli({
      args: ["transform-test", "run", String(created.id), "--json"],
      env: authEnv(),
      timeoutMs: 120_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const run = parseJson(result.stdout, TransformTestRunResult);
    expect(run.status).toBe("passed");
    expect(run.expectations).toEqual([
      expect.objectContaining({
        name: "one row per status",
        type: "equals",
        status: "passed",
        "row-counts": { actual: 2, expected: 2 },
        "extra-rows": [],
        "missing-rows": [],
        "cell-mismatches": [],
      }),
    ]);
  });

  it("delete --yes removes the test and a later get is a 404", async () => {
    const created = await createTest();

    const deleted = await runCli({
      args: ["transform-test", "delete", String(created.id), "--yes", "--json"],
      env: authEnv(),
    });
    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: created.id,
    });

    const fetched = await runCli({
      args: ["transform-test", "get", String(created.id), "--json"],
      env: authEnv(),
    });
    expect(fetched.exitCode).toBe(1);
    expect(cliErrorMessage(fetched.stderr)).toBe(
      `Not found: GET /api/ee/transform-test/${created.id}.`,
    );
  });

  it("delete without --yes refuses when stdin is not a TTY", async () => {
    const created = await createTest();

    const result = await runCli({
      args: ["transform-test", "delete", String(created.id), "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `refusing to delete ${created.id} without confirmation — pass --yes to proceed non-interactively`,
    );
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-test", "get", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-test", "get", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: GET /api/ee/transform-test/9999999.");
  });
});

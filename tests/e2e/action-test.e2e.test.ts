import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { DataActionCreateInput } from "@metabase/client/domain/data-action";
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

const skipReason = requireServer("test › action tests", [
  "actionTests",
  "dataTestRuns",
  "dataActionsWithoutModel",
]);

const Created = z.object({ id: z.number().int() });

const ACTION_BODY: DataActionCreateInput = {
  name: "Rename customer",
  type: "query",
  collection_id: null,
  dataset_query: {
    "lib/type": "mbql/query",
    database: SEEDED.warehouseDbId,
    stages: [
      {
        "lib/type": "mbql.stage/native",
        native: "UPDATE customers SET full_name = {{full_name}} WHERE id = {{customer_id}}",
        "template-tags": {
          customer_id: {
            id: "customer_id",
            name: "customer_id",
            "display-name": "Customer ID",
            type: "number",
            required: true,
          },
          full_name: {
            id: "full_name",
            name: "full_name",
            "display-name": "Full name",
            type: "text",
            required: true,
          },
        },
      },
    ],
  },
  parameters: [
    {
      id: "customer_id",
      slug: "customer_id",
      name: "Customer ID",
      type: "number/=",
      target: ["variable", ["template-tag", "customer_id"]],
      required: true,
    },
    {
      id: "full_name",
      slug: "full_name",
      name: "Full name",
      type: "string/=",
      target: ["variable", ["template-tag", "full_name"]],
      required: true,
    },
  ],
};

const PARAMETERS = { customer_id: 1, full_name: "Ada Lovelace" };

const INPUTS = [
  {
    table: { schema: "public", name: "customers" },
    format: "rows",
    columns: [
      { name: "id", cast_type: "INTEGER" },
      { name: "full_name", cast_type: "TEXT" },
    ],
    rows: [
      { id: 1, full_name: "Ada" },
      { id: 2, full_name: "Grace" },
    ],
  },
];

const EXPECTATIONS = [
  {
    type: "empty",
    name: "only customer 1 is renamed",
    sql: "SELECT * FROM public.customers WHERE (id = 1 AND full_name <> 'Ada Lovelace') OR (id = 2 AND full_name <> 'Grace')",
  },
];

describe.skipIf(skipReason !== null)("test e2e, action tests", () => {
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

  async function createAction(): Promise<number> {
    const enabled = await mb(["db", "set-data-actions", String(SEEDED.warehouseDbId), "true"]);
    expect(enabled.exitCode, enabled.stderr).toBe(0);
    const action = await mb(["data-action", "create", "--json"], JSON.stringify(ACTION_BODY));
    expect(action.exitCode, action.stderr).toBe(0);
    return parseJson(action.stdout, Created).id;
  }

  async function createActionTest(actionId: number): Promise<number> {
    const test = await mb(
      ["test", "create", "--id", `action:${actionId}`, "--json"],
      JSON.stringify({
        name: "renames one customer",
        parameters: PARAMETERS,
        inputs: INPUTS,
        expectations: EXPECTATIONS,
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    return parseJson(test.stdout, Created).id;
  }

  it("creates an action test and lists it under its action", async () => {
    const actionId = await createAction();
    const testId = await createActionTest(actionId);

    const list = await mb(["test", "list", "--id", `action:${actionId}`, "--json"]);

    expect(list.exitCode, list.stderr).toBe(0);
    expect(parseJson(list.stdout, TestListEnvelope)).toEqual({
      data: [
        {
          test_type: "action",
          id: testId,
          target_id: actionId,
          name: "renames one customer",
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

  it("gets an action test in full, with its parameter values, its inputs and no run yet", async () => {
    const actionId = await createAction();
    const testId = await createActionTest(actionId);

    const get = await mb(["test", "get", "--id", `action-test:${testId}`, "--full", "--json"]);

    expect(get.exitCode, get.stderr).toBe(0);
    expect(parseJson(get.stdout, DATA_TEST_SCHEMAS.action)).toEqual({
      id: testId,
      entity_id: expect.any(String),
      action_id: actionId,
      creator_id: expect.any(Number),
      name: "renames one customer",
      description: null,
      parameters: PARAMETERS,
      inputs: INPUTS,
      expectations: EXPECTATIONS,
      created_at: expect.any(String),
      updated_at: expect.any(String),
      last_run: null,
    });
  });

  it("updates only the fields the body carries", async () => {
    const actionId = await createAction();
    const testId = await createActionTest(actionId);

    const update = await mb(
      ["test", "update", "--id", `action-test:${testId}`, "--json"],
      JSON.stringify({ name: "renamed", description: "pins which row the action writes" }),
    );

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, DataTestCompact)).toEqual({
      id: testId,
      name: "renamed",
      description: "pins which row the action writes",
    });
  });

  it("runs the action with the test's parameter values against its fixtures, and lists the run in the test's history", async () => {
    const actionId = await createAction();
    const testId = await createActionTest(actionId);

    const run = await mb(["test", "run", "--id", `action-test:${testId}`, "--json"]);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(parseJson(run.stdout, DataTestRunResult)).toEqual({
      status: "passed",
      expectations: [{ name: "only customer 1 is renamed", type: "empty", status: "passed" }],
      tables: expect.any(Object),
    });

    const runs = await mb(["test", "runs", "--id", `action-test:${testId}`, "--json"]);

    expect(runs.exitCode, runs.stderr).toBe(0);
    expect(parseJson(runs.stdout, TestRunListEnvelope)).toEqual({
      data: [
        {
          id: expect.any(Number),
          test_type: "action",
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

  it("exits 1 when the tables the action wrote fail an expectation, naming the test", async () => {
    const actionId = await createAction();
    const test = await mb(
      ["test", "create", "--id", `action:${actionId}`, "--json"],
      JSON.stringify({
        name: "renames every customer",
        parameters: PARAMETERS,
        inputs: INPUTS,
        expectations: [
          {
            type: "empty",
            name: "no customer keeps their name",
            sql: "SELECT * FROM public.customers WHERE full_name <> 'Ada Lovelace'",
          },
        ],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = parseJson(test.stdout, Created).id;

    const run = await mb(["test", "run", "--id", `action-test:${testId}`]);

    expect(run.exitCode).toBe(1);
    expect(cliErrorMessage(run.stderr)).toBe(`action-test:${testId} failed`);
  });

  it("refuses a value for a parameter the action does not have", async () => {
    const actionId = await createAction();

    const test = await mb(
      ["test", "create", "--id", `action:${actionId}`, "--json"],
      JSON.stringify({
        name: "renames one customer",
        parameters: { ...PARAMETERS, colour: "red" },
        inputs: INPUTS,
        expectations: EXPECTATIONS,
      }),
    );

    expect(test.exitCode).toBe(1);
    expect(cliErrorMessage(test.stderr)).toContain(
      "The test's parameter values do not fit the action:",
    );
  });

  it("deletes an action test, after which it is not found", async () => {
    const actionId = await createAction();
    const testId = await createActionTest(actionId);

    const deleted = await mb([
      "test",
      "delete",
      "--id",
      `action-test:${testId}`,
      "--yes",
      "--json",
    ]);

    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: testId,
    });

    const get = await mb(["test", "get", "--id", `action-test:${testId}`, "--json"]);

    expect(get.exitCode).toBe(1);
    expect(cliErrorMessage(get.stderr)).toBe(`Not found: GET /api/ee/action-test/${testId}.`);
  });
});

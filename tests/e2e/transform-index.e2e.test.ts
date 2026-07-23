import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformRunResult } from "../../src/commands/transform/run";
import { TransformIndexListEnvelope } from "../../src/commands/transform-index/list";
import { TransformCompact } from "../../src/domain/transform";
import {
  TransformIndex,
  TransformIndexRequest,
  TransformIndexRequestCompact,
} from "../../src/domain/transform-index";
import { listEnvelopeSchema } from "../../src/output/types";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const FIRST_TRANSFORM_ID = 1;
const INDEX_NAME = "idx_one";
const TARGET_COLUMN = "one";
const TRANSFORM_TARGET_TABLE = "e2e_index_transform";

const STRUCTURED = { kind: "btree", name: INDEX_NAME, columns: [{ name: TARGET_COLUMN }] };
const UPDATED_STRUCTURED = {
  kind: "btree",
  name: INDEX_NAME,
  columns: [{ name: TARGET_COLUMN }],
  unique: true,
};

const TRANSFORM_BODY = {
  name: TRANSFORM_TARGET_TABLE,
  source: {
    type: "query",
    query: {
      type: "native",
      database: SEEDED.warehouseDbId,
      native: { query: `SELECT 1 AS ${TARGET_COLUMN}` },
    },
  },
  target: {
    type: "table",
    database: SEEDED.warehouseDbId,
    schema: "public",
    name: TRANSFORM_TARGET_TABLE,
  },
};

const skipReason = requireServer({ minVersion: 64, tokenFeature: "transforms-basic" });

describe.skipIf(skipReason !== null)("transform-index e2e", () => {
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

  async function createSeedTransform(): Promise<void> {
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(TRANSFORM_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformCompact).id).toBe(FIRST_TRANSFORM_ID);
  }

  async function createIndexRequest(): Promise<TransformIndexRequestCompact> {
    const result = await runCli({
      args: ["transform-index", "create", "--json"],
      stdin: JSON.stringify({ transform_id: FIRST_TRANSFORM_ID, structured: STRUCTURED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, TransformIndexRequestCompact);
  }

  async function seedTransformIndex(): Promise<TransformIndexRequestCompact> {
    await createSeedTransform();
    return createIndexRequest();
  }

  // A first run of a table-target transform is a full-create run, which applies pending index
  // requests and settles their status synchronously before the run is marked succeeded.
  async function runTransformToCompletion(): Promise<void> {
    const result = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: 60_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformRunResult).final?.status).toBe("succeeded");
  }

  it("create returns a create-pending request; get round-trips it by id", async () => {
    const created = await seedTransformIndex();
    expect(created).toEqual({
      id: created.id,
      transform_id: FIRST_TRANSFORM_ID,
      index_name: INDEX_NAME,
      status: "create-pending",
      structured: STRUCTURED,
      error_message: null,
    });

    const getResult = await runCli({
      args: ["transform-index", "get", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformIndexRequestCompact)).toEqual({
      id: created.id,
      transform_id: FIRST_TRANSFORM_ID,
      index_name: INDEX_NAME,
      status: "create-pending",
      structured: STRUCTURED,
      error_message: null,
    });
  });

  it("list surfaces the managed request as a not-yet-present declared index", async () => {
    const created = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "list", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformIndexListEnvelope)).toEqual({
      data: [
        {
          name: INDEX_NAME,
          kind: "btree",
          key_columns: [TARGET_COLUMN],
          is_unique: false,
          is_primary: false,
          metabase_managed: true,
          present_in_warehouse: false,
          request: {
            id: created.id,
            transform_id: FIRST_TRANSFORM_ID,
            index_name: INDEX_NAME,
            status: "create-pending",
            structured: STRUCTURED,
            error_message: null,
          },
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("a full run creates the index in the warehouse and reports it as observed there", async () => {
    const created = await seedTransformIndex();
    await runTransformToCompletion();

    const result = await runCli({
      args: ["transform-index", "list", String(FIRST_TRANSFORM_ID), "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, listEnvelopeSchema(TransformIndex))).toEqual({
      data: [
        {
          metabase_managed: true,
          present_in_warehouse: true,
          name: INDEX_NAME,
          kind: "btree",
          key_columns: [TARGET_COLUMN],
          include_columns: [],
          is_unique: false,
          is_primary: false,
          is_valid: true,
          partial_predicate: null,
          access_method: "btree",
          request: {
            id: created.id,
            transform_id: FIRST_TRANSFORM_ID,
            index_name: INDEX_NAME,
            structured: STRUCTURED,
            status: "succeeded",
            error_message: null,
            created_by: expect.any(Number),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            last_executed_at: expect.any(String),
          },
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("a full run settles the index request entity to succeeded with an execution timestamp", async () => {
    const created = await seedTransformIndex();
    await runTransformToCompletion();

    const result = await runCli({
      args: ["transform-index", "get", String(created.id), "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformIndexRequest)).toEqual({
      id: created.id,
      transform_id: FIRST_TRANSFORM_ID,
      index_name: INDEX_NAME,
      structured: STRUCTURED,
      status: "succeeded",
      error_message: null,
      created_by: expect.any(Number),
      created_at: expect.any(String),
      updated_at: expect.any(String),
      last_executed_at: expect.any(String),
    });
  });

  it("update replaces the definition and marks the request update-pending", async () => {
    const created = await seedTransformIndex();

    const updateResult = await runCli({
      args: ["transform-index", "update", String(created.id), "--json"],
      stdin: JSON.stringify({ structured: UPDATED_STRUCTURED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, TransformIndexRequestCompact)).toEqual({
      id: created.id,
      transform_id: FIRST_TRANSFORM_ID,
      index_name: INDEX_NAME,
      status: "update-pending",
      structured: UPDATED_STRUCTURED,
      error_message: null,
    });
  });

  it("update refuses to change the index kind (400 from the stable-key guard)", async () => {
    const created = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "update", String(created.id), "--json"],
      stdin: JSON.stringify({
        structured: { kind: "hash", name: INDEX_NAME, columns: [{ name: TARGET_COLUMN }] },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400.");
  });

  it("delete --yes marks the request delete-pending; get still shows it in that state", async () => {
    const created = await seedTransformIndex();

    const deleteResult = await runCli({
      args: ["transform-index", "delete", String(created.id), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: created.id,
    });

    const getResult = await runCli({
      args: ["transform-index", "get", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformIndexRequestCompact)).toEqual({
      id: created.id,
      transform_id: FIRST_TRANSFORM_ID,
      index_name: INDEX_NAME,
      status: "delete-pending",
      structured: STRUCTURED,
      error_message: null,
    });
  });

  it("create rejects a duplicate index name for the same transform (400)", async () => {
    await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "create", "--json"],
      stdin: JSON.stringify({ transform_id: FIRST_TRANSFORM_ID, structured: STRUCTURED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400.");
  });

  it("create with an empty body fails Zod validation before sending", async () => {
    const result = await runCli({
      args: ["transform-index", "create", "--json"],
      stdin: JSON.stringify({}),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("create with an unknown structured kind fails Zod validation before sending", async () => {
    const result = await runCli({
      args: ["transform-index", "create", "--json"],
      stdin: JSON.stringify({ transform_id: FIRST_TRANSFORM_ID, structured: { kind: "nope" } }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-index", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-index", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/index/request/9999999.");
  });

  it("update against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-index", "update", "9999999", "--json"],
      stdin: JSON.stringify({ structured: STRUCTURED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: PUT /api/index/request/9999999.");
  });

  it("delete without --yes refuses in non-TTY and exits 2", async () => {
    const created = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "delete", String(created.id), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `refusing to delete ${created.id} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
  });

  it("list without the transform id positional fails on the missing argument", async () => {
    const result = await runCli({
      args: ["transform-index", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required positional argument: TRANSFORMID");
  });

  it("list with a non-integer transform id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-index", "list", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("list against a missing transform surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-index", "list", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/index?transform-id=9999999.");
  });
});

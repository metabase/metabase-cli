import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TransformCompact, TransformRunResult } from "@metabase/client/domain/transform";
import {
  TransformIndex,
  TransformIndexRequest,
  TransformIndexRequestCompact,
  type TransformIndexStructured,
} from "@metabase/client/domain/transform-index";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { TransformIndexListEnvelope } from "../../packages/cli/src/commands/transform-index/list";
import { listEnvelopeSchema } from "../../packages/cli/src/output/types";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const INDEX_NAME = "idx_one";
const TARGET_COLUMN = "one";
const TRANSFORM_TARGET_TABLE = "e2e_index_transform";

// The body it rides on fails the client-side parse, so this never reaches a transform.
const UNSENT_TRANSFORM_ID = 1;

const STRUCTURED: TransformIndexStructured = {
  kind: "btree",
  name: INDEX_NAME,
  columns: [{ name: TARGET_COLUMN }],
};

const UNIQUE_STRUCTURED: TransformIndexStructured = { ...STRUCTURED, unique: true };

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

interface SeededIndex {
  transformId: number;
  request: TransformIndexRequestCompact;
}

function expectedRequest(
  id: unknown,
  transformId: number,
  status: string,
  structured: object = STRUCTURED,
) {
  return {
    id,
    transform_id: transformId,
    index_name: INDEX_NAME,
    status,
    structured,
    error_message: null,
  };
}

const skipReason = requireServer("transform-index › transform-index e2e", { minVersion: 64 });

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

  async function createSeedTransform(): Promise<number> {
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(TRANSFORM_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, TransformCompact).id;
  }

  async function seedTransformIndex(): Promise<SeededIndex> {
    const transformId = await createSeedTransform();
    const result = await runCli({
      args: ["transform-index", "create", "--json"],
      stdin: JSON.stringify({ transform_id: transformId, structured: STRUCTURED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return { transformId, request: parseJson(result.stdout, TransformIndexRequestCompact) };
  }

  // A first run of a table-target transform is a full-create run, which applies pending index
  // requests and settles their status before the run is marked succeeded.
  async function runTransformToCompletion(transformId: number): Promise<void> {
    const result = await runCli({
      args: ["transform", "run", String(transformId), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: 60_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformRunResult).final?.status).toBe("succeeded");
  }

  it("create returns a create-pending request; get round-trips it by id", async () => {
    const { transformId, request } = await seedTransformIndex();
    expect(request).toEqual(expectedRequest(expect.any(Number), transformId, "create-pending"));

    const getResult = await runCli({
      args: ["transform-index", "get", String(request.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformIndexRequestCompact)).toEqual(
      expectedRequest(request.id, transformId, "create-pending"),
    );
  });

  it("list surfaces the managed request as a not-yet-present declared index", async () => {
    const { transformId, request } = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "list", String(transformId), "--json"],
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
          request: expectedRequest(request.id, transformId, "create-pending"),
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("a full run creates the index in the warehouse and reports it as observed there", async () => {
    const { transformId, request } = await seedTransformIndex();
    await runTransformToCompletion(transformId);

    const result = await runCli({
      args: ["transform-index", "list", String(transformId), "--full", "--json"],
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
            id: request.id,
            transform_id: transformId,
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
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("a full run settles the index request entity to succeeded with an execution timestamp", async () => {
    const { transformId, request } = await seedTransformIndex();
    await runTransformToCompletion(transformId);

    const result = await runCli({
      args: ["transform-index", "get", String(request.id), "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformIndexRequest)).toEqual({
      id: request.id,
      transform_id: transformId,
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
    const { transformId, request } = await seedTransformIndex();

    const updateResult = await runCli({
      args: ["transform-index", "update", String(request.id), "--json"],
      stdin: JSON.stringify({ structured: UNIQUE_STRUCTURED }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, TransformIndexRequestCompact)).toEqual(
      expectedRequest(request.id, transformId, "update-pending", UNIQUE_STRUCTURED),
    );
  });

  it("update refuses to change the index kind, which is fixed at creation", async () => {
    const { request } = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "update", String(request.id), "--json"],
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
    const { transformId, request } = await seedTransformIndex();

    const deleteResult = await runCli({
      args: ["transform-index", "delete", String(request.id), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: request.id,
    });

    const getResult = await runCli({
      args: ["transform-index", "get", String(request.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformIndexRequestCompact)).toEqual(
      expectedRequest(request.id, transformId, "delete-pending"),
    );
  });

  it("create rejects a second request under an index name the transform already carries", async () => {
    const { transformId } = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "create", "--json"],
      stdin: JSON.stringify({ transform_id: transformId, structured: STRUCTURED }),
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
      stdin: JSON.stringify({ transform_id: UNSENT_TRANSFORM_ID, structured: { kind: "nope" } }),
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
    const { request } = await seedTransformIndex();

    const result = await runCli({
      args: ["transform-index", "delete", String(request.id), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `refusing to delete ${request.id} without confirmation — pass --yes to proceed non-interactively`,
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

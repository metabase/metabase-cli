import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { z } from "zod";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformCancelResult } from "../../src/commands/transform/cancel";
import { TransformListEnvelope } from "../../src/commands/transform/list";
import { RUN_TERMINAL_STATUSES, TransformRunResult } from "../../src/commands/transform/run";
import { TransformRunListEnvelope } from "../../src/commands/transform/runs";
import { createClient, type Client } from "../../src/core/http/client";
import { ValidationOutcome } from "../../src/core/schema/validate";
import { TransformCompact, TransformRun, TransformRunCompact } from "../../src/domain/transform";
import { parseJson } from "../../src/runtime/json";
import { pollUntil } from "../../src/runtime/poll";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";
const FIRST_TRANSFORM_ID = 1;
const TRANSFORM_NAME = "e2e_transform";
const TRANSFORM_TARGET_TABLE = "e2e_transform";

interface NativeQuery {
  type: "native";
  database: number;
  native: { query: string };
}

interface TransformBody {
  name: string;
  source: { type: "query"; query: NativeQuery };
  target: { type: "table"; database: number; schema: string; name: string };
}

const RunStatusResponse = z.object({ status: z.string() }).loose();

async function waitForRunComplete(client: Client, runId: number): Promise<void> {
  await pollUntil(
    async () => client.requestParsed(RunStatusResponse, `/api/transform/run/${runId}`),
    (run) => RUN_TERMINAL_STATUSES.has(run.status),
    { intervalMs: 500, timeoutMs: 30_000 },
  );
}

async function waitForRunStarted(client: Client, runId: number): Promise<void> {
  await pollUntil(
    async () => client.requestParsed(RunStatusResponse, `/api/transform/run/${runId}`),
    (run) => run.status === "started",
    { intervalMs: 200, timeoutMs: 15_000 },
  );
}

const TRANSFORM_BODY: TransformBody = {
  name: TRANSFORM_NAME,
  source: {
    type: "query",
    query: {
      type: "native",
      database: SEEDED.warehouseDbId,
      native: { query: "SELECT 1 AS one" },
    },
  },
  target: {
    type: "table",
    database: SEEDED.warehouseDbId,
    schema: "public",
    name: TRANSFORM_TARGET_TABLE,
  },
};

const TRANSFORM_COMPACT = {
  id: FIRST_TRANSFORM_ID,
  name: TRANSFORM_NAME,
  description: null,
  source_type: "native",
  target: {
    type: "table",
    database: SEEDED.warehouseDbId,
    schema: "public",
    name: TRANSFORM_TARGET_TABLE,
  },
  target_db_id: SEEDED.warehouseDbId,
} as const;

const skipReason = requireServer({ minVersion: 59 });

describe.skipIf(skipReason !== null)("transform e2e", () => {
  let bootstrap: E2EBootstrap;
  let adminClient: Client;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    adminClient = createClient({ url: bootstrap.baseUrl, apiKey: bootstrap.adminApiKey });
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

  async function createSeedTransform(): Promise<TransformCompact> {
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(TRANSFORM_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, TransformCompact);
    expect(created).toEqual(TRANSFORM_COMPACT);
    return created;
  }

  it("list returns the just-created transform as the only entry", async () => {
    await createSeedTransform();

    const result = await runCli({
      args: ["transform", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformListEnvelope)).toEqual({
      data: [TRANSFORM_COMPACT],
      returned: 1,
      total: 1,
    });
  });

  it("create + get round-trip returns the same transform by id", async () => {
    await createSeedTransform();

    const result = await runCli({
      args: ["transform", "get", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformCompact)).toEqual(TRANSFORM_COMPACT);
  });

  it("update changes the name and the change is visible via get", async () => {
    await createSeedTransform();
    const renamed = `${TRANSFORM_NAME}_renamed`;

    const updateResult = await runCli({
      args: ["transform", "update", String(FIRST_TRANSFORM_ID), "--json"],
      stdin: JSON.stringify({ name: renamed }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, TransformCompact)).toEqual({
      ...TRANSFORM_COMPACT,
      name: renamed,
    });

    const getResult = await runCli({
      args: ["transform", "get", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformCompact)).toEqual({
      ...TRANSFORM_COMPACT,
      name: renamed,
    });
  });

  it("delete --yes removes the transform; subsequent get returns 404", async () => {
    await createSeedTransform();

    const deleteResult = await runCli({
      args: ["transform", "delete", String(FIRST_TRANSFORM_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_TRANSFORM_ID,
    });

    const getResult = await runCli({
      args: ["transform", "get", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain(`Not found: GET /api/transform/${FIRST_TRANSFORM_ID}.`);
  });

  it("run --wait polls until the run reaches a terminal status and renders the final state", async () => {
    await createSeedTransform();

    const result = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, TransformRunResult);
    expect(parsed.message).toBe("Transform run started");
    expect(parsed.run_id).not.toBeNull();
    expect(parsed.final?.status).toBe("succeeded");
  });

  it("run --wait --json on a failing transform exits 1 with a stderr summary that does not duplicate final.message", async () => {
    const failName = "e2e_transform_fail";
    const failingBody: TransformBody = {
      name: failName,
      source: {
        type: "query",
        query: {
          type: "native",
          database: SEEDED.warehouseDbId,
          native: { query: "SELECT 1 FROM does_not_exist" },
        },
      },
      target: {
        type: "table",
        database: SEEDED.warehouseDbId,
        schema: "public",
        name: failName,
      },
    };

    const createResult = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(failingBody),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(createResult.exitCode, createResult.stderr).toBe(0);
    const created = parseJson(createResult.stdout, TransformCompact);

    const runResult = await runCli({
      args: ["transform", "run", String(created.id), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(runResult.exitCode).toBe(1);
    const parsed = parseJson(runResult.stdout, TransformRunResult);
    const finalRun = parsed.final;
    if (finalRun === null) {
      throw new Error("expected final run to be populated when --wait is set");
    }
    const failureDetail = finalRun.message;
    if (failureDetail === null) {
      throw new Error("expected failed run to carry a message");
    }

    expect(finalRun.status).toBe("failed");
    expect(runResult.stderr).toContain(`transform run ${parsed.run_id} failed`);
    expect(runResult.stderr).not.toContain(failureDetail);
  });

  it("run returns a run_id for the created transform", async () => {
    await createSeedTransform();

    const result = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, TransformRunResult);
    expect(parsed.message).toBe("Transform run started");
    expect(parsed.run_id).not.toBeNull();

    if (parsed.run_id !== null) {
      await waitForRunComplete(adminClient, parsed.run_id);
    }
  });

  it("delete-table drops the output table while keeping the transform record", async () => {
    await createSeedTransform();

    const runResult = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(runResult.exitCode, runResult.stderr).toBe(0);

    const dropResult = await runCli({
      args: ["transform", "delete-table", String(FIRST_TRANSFORM_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(dropResult.exitCode, dropResult.stderr).toBe(0);
    expect(parseJson(dropResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_TRANSFORM_ID,
    });

    const getResult = await runCli({
      args: ["transform", "get", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformCompact)).toEqual(TRANSFORM_COMPACT);
  });

  it("create with body missing required fields fails on Zod validation", async () => {
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-source-and-target" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/transform/9999999.");
  });

  it("create with invalid MBQL 5 source.query fails pre-flight before sending", async () => {
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify({
        name: "preflight-fail",
        source: {
          type: "query",
          query: {
            "lib/type": "mbql/query",
            database: "oops not an integer",
            stages: [
              {
                "lib/type": "mbql.stage/mbql",
                "source-table": SEEDED.tables.orders,
              },
            ],
          },
        },
        target: {
          type: "table",
          database: SEEDED.warehouseDbId,
          schema: "public",
          name: "preflight_fail_target",
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
    expect(result.stderr).toContain(
      "transform.source.query validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
    );
  });

  it("update with invalid MBQL 5 source.query fails pre-flight before sending", async () => {
    await createSeedTransform();
    const result = await runCli({
      args: ["transform", "update", String(FIRST_TRANSFORM_ID), "--json"],
      stdin: JSON.stringify({
        source: {
          type: "query",
          query: {
            "lib/type": "mbql/query",
            database: "oops",
            stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 99 }],
          },
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(parseJson(result.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
    expect(result.stderr).toContain(
      "transform.source.query validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
    );
  });

  it("create --skip-validate bypasses the MBQL 5 pre-flight (server is the authority)", async () => {
    const result = await runCli({
      args: ["transform", "create", "--skip-validate", "--json"],
      stdin: JSON.stringify({
        name: "skip-validate-bypass",
        source: {
          type: "query",
          query: {
            "lib/type": "mbql/query",
            database: "oops",
            stages: [{ "lib/type": "mbql.stage/mbql", "source-table": SEEDED.tables.orders }],
          },
        },
        target: {
          type: "table",
          database: SEEDED.warehouseDbId,
          schema: "public",
          name: "skip_validate_bypass_target",
        },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("source.query.lib/metadata: missing required key");
    expect(result.stdout).toBe("");
  });

  it("get-run returns the run we just kicked off, parsed against TransformRun", async () => {
    await createSeedTransform();

    const runResult = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(runResult.exitCode, runResult.stderr).toBe(0);
    const kickoff = parseJson(runResult.stdout, TransformRunResult);
    const runId = kickoff.run_id;
    if (runId === null) {
      throw new Error("expected kickoff to return a run_id");
    }

    const result = await runCli({
      args: ["transform", "get-run", String(runId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const run = parseJson(result.stdout, TransformRunCompact);
    expect(run).toEqual({
      id: runId,
      transform_id: FIRST_TRANSFORM_ID,
      status: "succeeded",
      run_method: "manual",
      start_time: expect.any(String),
      end_time: expect.any(String),
      message: null,
    });
  });

  it("get-run with non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "get-run", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid run id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get-run against a missing run id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform", "get-run", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/transform/run/9999999.");
  });

  it("runs lists the recently-completed run for the seeded transform", async () => {
    await createSeedTransform();

    const runResult = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(runResult.exitCode, runResult.stderr).toBe(0);
    const kickoff = parseJson(runResult.stdout, TransformRunResult);
    const runId = kickoff.run_id;
    if (runId === null) {
      throw new Error("expected kickoff to return a run_id");
    }

    const result = await runCli({
      args: ["transform", "runs", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformRunListEnvelope)).toEqual({
      data: [
        {
          id: runId,
          transform_id: FIRST_TRANSFORM_ID,
          status: "succeeded",
          run_method: "manual",
          start_time: expect.any(String),
          end_time: expect.any(String),
          message: null,
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("runs --transform-id <id> filters to that transform's runs only", async () => {
    await createSeedTransform();

    const otherCreate = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify({
        ...TRANSFORM_BODY,
        name: `${TRANSFORM_NAME}_other`,
        target: { ...TRANSFORM_BODY.target, name: `${TRANSFORM_TARGET_TABLE}_other` },
      }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(otherCreate.exitCode, otherCreate.stderr).toBe(0);
    const otherTransform = parseJson(otherCreate.stdout, TransformCompact);

    const runResults = await Promise.all(
      [FIRST_TRANSFORM_ID, otherTransform.id].map(async (transformId) =>
        runCli({
          args: ["transform", "run", String(transformId), "--wait", "--json"],
          configHome: await makeIsolatedConfigHome(),
          env: authEnv(),
        }),
      ),
    );
    for (const runResult of runResults) {
      expect(runResult.exitCode, runResult.stderr).toBe(0);
    }

    const result = await runCli({
      args: ["transform", "runs", "--transform-id", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformRunListEnvelope)).toEqual({
      data: [
        {
          id: expect.any(Number),
          transform_id: FIRST_TRANSFORM_ID,
          status: "succeeded",
          run_method: "manual",
          start_time: expect.any(String),
          end_time: expect.any(String),
          message: null,
        },
      ],
      returned: 1,
      total: 1,
    });
  });

  it("runs --limit caps the result count to the requested page", async () => {
    await createSeedTransform();

    const runResult = await runCli({
      args: ["transform", "run", String(FIRST_TRANSFORM_ID), "--wait", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(runResult.exitCode, runResult.stderr).toBe(0);

    const result = await runCli({
      args: ["transform", "runs", "--limit", "1", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformRunListEnvelope)).toEqual({
      data: [
        {
          id: expect.any(Number),
          transform_id: FIRST_TRANSFORM_ID,
          status: "succeeded",
          run_method: "manual",
          start_time: expect.any(String),
          end_time: expect.any(String),
          message: null,
        },
      ],
      returned: 1,
      limit: 1,
    });
  });

  it("runs with non-integer --transform-id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "runs", "--transform-id", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid --transform-id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("cancel marks an in-progress run as canceling", async () => {
    const sleepBody: TransformBody = {
      name: "e2e_transform_cancel",
      source: {
        type: "query",
        query: {
          type: "native",
          database: SEEDED.warehouseDbId,
          native: { query: "WITH s AS (SELECT pg_sleep(20)) SELECT 1 AS one FROM s" },
        },
      },
      target: {
        type: "table",
        database: SEEDED.warehouseDbId,
        schema: "public",
        name: "e2e_transform_cancel",
      },
    };
    const createResult = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(sleepBody),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(createResult.exitCode, createResult.stderr).toBe(0);
    const created = parseJson(createResult.stdout, TransformCompact);

    const kickoffResult = await runCli({
      args: ["transform", "run", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(kickoffResult.exitCode, kickoffResult.stderr).toBe(0);
    const kickoff = parseJson(kickoffResult.stdout, TransformRunResult);
    const runId = kickoff.run_id;
    if (runId === null) {
      throw new Error("expected kickoff to return a run_id");
    }
    await waitForRunStarted(adminClient, runId);

    const cancelResult = await runCli({
      args: ["transform", "cancel", String(created.id), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(cancelResult.exitCode, cancelResult.stderr).toBe(0);
    expect(parseJson(cancelResult.stdout, TransformCancelResult)).toEqual({
      canceled: true,
      id: created.id,
    });

    await waitForRunComplete(adminClient, runId);
    const finalRun = await adminClient.requestParsed(TransformRun, `/api/transform/run/${runId}`);
    expect(finalRun.status).toBe("canceled");
  });

  it("cancel with no running run surfaces a 404 HttpError", async () => {
    await createSeedTransform();

    const result = await runCli({
      args: ["transform", "cancel", String(FIRST_TRANSFORM_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Not found: POST /api/transform/${FIRST_TRANSFORM_ID}/cancel.`);
  });

  it("cancel with non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "cancel", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("delete without --yes proceeds in non-TTY (auto-confirm matches kubectl/gh/docker convention)", async () => {
    await createSeedTransform();

    const result = await runCli({
      args: ["transform", "delete", String(FIRST_TRANSFORM_ID), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_TRANSFORM_ID,
    });
  });
});

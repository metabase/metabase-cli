import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { z } from "zod";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformListEnvelope } from "../../src/commands/transform/list";
import { TransformRunResult } from "../../src/commands/transform/run";
import { createClient, type Client } from "../../src/core/http/client";
import { ValidationOutcome } from "../../src/core/schema/validate";
import { TransformCompact } from "../../src/domain/transform";
import { parseJson } from "../../src/runtime/json";
import { pollUntil } from "../../src/runtime/poll";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES, E2E_TABLES } from "./seed/ids";

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

const RUN_TERMINAL_STATUSES = new Set(["succeeded", "failed", "timeout", "canceled"]);

const RunStatusResponse = z.object({ status: z.string() }).loose();

async function waitForRunComplete(client: Client, runId: number): Promise<void> {
  await pollUntil(
    async () => client.requestParsed(RunStatusResponse, `/api/transform/run/${runId}`),
    (run) => RUN_TERMINAL_STATUSES.has(run.status),
    { intervalMs: 500, timeoutMs: 30_000 },
  );
}

const TRANSFORM_BODY: TransformBody = {
  name: TRANSFORM_NAME,
  source: {
    type: "query",
    query: {
      type: "native",
      database: E2E_DATABASES.WAREHOUSE,
      native: { query: "SELECT 1 AS one" },
    },
  },
  target: {
    type: "table",
    database: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    name: TRANSFORM_TARGET_TABLE,
  },
};

const TRANSFORM_COMPACT = {
  id: FIRST_TRANSFORM_ID,
  name: TRANSFORM_NAME,
  description: null,
  source_type: "native",
  target_db_id: E2E_DATABASES.WAREHOUSE,
} as const;

describe("transform e2e", () => {
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
    expect(getResult.stderr).toContain("Endpoint not found — is this a Metabase instance?");
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
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
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
                "source-table": E2E_TABLES.ORDERS,
              },
            ],
          },
        },
        target: {
          type: "table",
          database: E2E_DATABASES.WAREHOUSE,
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

  it("delete without --yes and without TTY stdin fails with ConfigError", async () => {
    const result = await runCli({
      args: ["transform", "delete", "1", "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--yes required to delete non-interactively");
    expect(result.stdout).toBe("");
  });
});

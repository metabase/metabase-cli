import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { z } from "zod";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformListEnvelope } from "../../src/commands/transform/list";
import { TransformRunResult } from "../../src/commands/transform/run";
import { createClient, type Client } from "../../src/core/http/client";
import { TransformCompact } from "../../src/domain/transform";
import { parseJson } from "../../src/runtime/json";
import { pollUntil } from "../../src/runtime/poll";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES } from "./seed/ids";

const RUN_NONCE = `${Date.now()}_${process.pid}`;

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

function makeTransformBody(slug: string): TransformBody {
  return {
    name: `e2e_transform_${slug}_${RUN_NONCE}`,
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
      name: `e2e_transform_${slug}_${RUN_NONCE}`,
    },
  };
}

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

  async function createTransform(slug: string): Promise<TransformCompact> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(makeTransformBody(slug)),
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, TransformCompact);
  }

  async function deleteTransform(id: number): Promise<void> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "delete", String(id), "--yes", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  async function dropTransformOutputTable(id: number): Promise<void> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "delete-table", String(id), "--yes", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list returns the current set of transforms parsed via the envelope", async () => {
    const created = await createTransform("list");
    try {
      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["transform", "list", "--json"],
        configHome,
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const envelope = parseJson(result.stdout, TransformListEnvelope);
      expect(envelope.returned).toBe(envelope.data.length);
      expect(envelope.total).toBe(envelope.data.length);
      const ours = envelope.data.find((row) => row.id === created.id);
      expect(ours).toEqual({
        id: created.id,
        name: created.name,
        description: null,
        source_type: "native",
        target_db_id: E2E_DATABASES.WAREHOUSE,
      });
    } finally {
      await deleteTransform(created.id);
    }
  });

  it("create + get round-trip returns the same transform by id", async () => {
    const created = await createTransform("getrt");
    try {
      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["transform", "get", String(created.id), "--json"],
        configHome,
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TransformCompact)).toEqual({
        id: created.id,
        name: created.name,
        description: null,
        source_type: "native",
        target_db_id: E2E_DATABASES.WAREHOUSE,
      });
    } finally {
      await deleteTransform(created.id);
    }
  });

  it("update changes the name and the change is visible via get", async () => {
    const created = await createTransform("update");
    const renamed = `${created.name}_renamed`;
    try {
      const updateConfigHome = await makeIsolatedConfigHome();
      const updateResult = await runCli({
        args: ["transform", "update", String(created.id), "--json"],
        stdin: JSON.stringify({ name: renamed }),
        configHome: updateConfigHome,
        env: authEnv(),
      });
      expect(updateResult.exitCode, updateResult.stderr).toBe(0);
      expect(parseJson(updateResult.stdout, TransformCompact)).toEqual({
        id: created.id,
        name: renamed,
        description: null,
        source_type: "native",
        target_db_id: E2E_DATABASES.WAREHOUSE,
      });

      const getConfigHome = await makeIsolatedConfigHome();
      const getResult = await runCli({
        args: ["transform", "get", String(created.id), "--json"],
        configHome: getConfigHome,
        env: authEnv(),
      });
      expect(getResult.exitCode, getResult.stderr).toBe(0);
      expect(parseJson(getResult.stdout, TransformCompact)).toEqual({
        id: created.id,
        name: renamed,
        description: null,
        source_type: "native",
        target_db_id: E2E_DATABASES.WAREHOUSE,
      });
    } finally {
      await deleteTransform(created.id);
    }
  });

  it("delete --yes removes the transform; subsequent get returns 404", async () => {
    const created = await createTransform("delete");

    const deleteConfigHome = await makeIsolatedConfigHome();
    const deleteResult = await runCli({
      args: ["transform", "delete", String(created.id), "--yes", "--json"],
      configHome: deleteConfigHome,
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: created.id,
    });

    const getConfigHome = await makeIsolatedConfigHome();
    const getResult = await runCli({
      args: ["transform", "get", String(created.id), "--json"],
      configHome: getConfigHome,
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("run --wait polls until the run reaches a terminal status and renders the final state", async () => {
    const created = await createTransform("waitsucc");
    let runId: number | null = null;
    try {
      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["transform", "run", String(created.id), "--wait", "--json"],
        configHome,
        env: authEnv(),
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const parsed = parseJson(result.stdout, TransformRunResult);
      expect(parsed.message).toBe("Transform run started");
      expect(parsed.run_id).not.toBeNull();
      expect(parsed.final).not.toBeNull();
      expect(parsed.final?.status).toBe("succeeded");
      runId = parsed.run_id;
    } finally {
      if (runId !== null) {
        await dropTransformOutputTable(created.id);
      }
      await deleteTransform(created.id);
    }
  });

  it("run returns a run_id for the created transform", async () => {
    const created = await createTransform("run");
    let runId: number | null = null;
    try {
      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["transform", "run", String(created.id), "--json"],
        configHome,
        env: authEnv(),
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const parsed = parseJson(result.stdout, TransformRunResult);
      expect(parsed.message).toBe("Transform run started");
      expect(parsed.run_id).not.toBeNull();
      runId = parsed.run_id;
    } finally {
      if (runId !== null) {
        await waitForRunComplete(adminClient, runId);
        await dropTransformOutputTable(created.id);
      }
      await deleteTransform(created.id);
    }
  });

  it("delete-table drops the output table while keeping the transform record", async () => {
    const created = await createTransform("droptbl");
    let tableExists = false;
    try {
      const runHome = await makeIsolatedConfigHome();
      const runResult = await runCli({
        args: ["transform", "run", String(created.id), "--wait", "--json"],
        configHome: runHome,
        env: authEnv(),
      });
      expect(runResult.exitCode, runResult.stderr).toBe(0);
      tableExists = true;

      const dropHome = await makeIsolatedConfigHome();
      const dropResult = await runCli({
        args: ["transform", "delete-table", String(created.id), "--yes", "--json"],
        configHome: dropHome,
        env: authEnv(),
      });
      expect(dropResult.exitCode, dropResult.stderr).toBe(0);
      expect(parseJson(dropResult.stdout, DeleteResult)).toEqual({
        deleted: true,
        aborted: false,
        id: created.id,
      });
      tableExists = false;

      const getHome = await makeIsolatedConfigHome();
      const getResult = await runCli({
        args: ["transform", "get", String(created.id), "--json"],
        configHome: getHome,
        env: authEnv(),
      });
      expect(getResult.exitCode, getResult.stderr).toBe(0);
      expect(parseJson(getResult.stdout, TransformCompact).id).toBe(created.id);
    } finally {
      if (tableExists) {
        await dropTransformOutputTable(created.id);
      }
      await deleteTransform(created.id);
    }
  });

  it("create with body missing required fields fails on Zod validation", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-source-and-target" }),
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "get", "abc", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "get", "9999999", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("delete without --yes and without TTY stdin fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform", "delete", "1", "--json"],
      stdin: "",
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--yes required to delete non-interactively");
    expect(result.stdout).toBe("");
  });
});

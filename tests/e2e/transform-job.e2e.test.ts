import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformJobListEnvelope } from "../../src/commands/transform-job/list";
import { TransformJobCompact } from "../../src/domain/transform-job";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const RUN_NONCE = `${Date.now()}_${process.pid}`;
const VALID_CRON = "0 0 0 * * ?";
const SECOND_CRON = "0 0 6 * * ?";

interface JobBody {
  name: string;
  schedule: string;
  ui_display_type?: "cron/raw" | "cron/builder";
}

function makeJobBody(slug: string): JobBody {
  return {
    name: `e2e_job_${slug}_${RUN_NONCE}`,
    schedule: VALID_CRON,
  };
}

describe("transform-job e2e", () => {
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
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  async function createJob(slug: string): Promise<TransformJobCompact> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform-job", "create", "--json"],
      stdin: JSON.stringify(makeJobBody(slug)),
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, TransformJobCompact);
  }

  async function deleteJob(id: number): Promise<void> {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform-job", "delete", String(id), "--yes", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list returns the current set of jobs parsed via the envelope", async () => {
    const created = await createJob("list");
    try {
      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["transform-job", "list", "--json"],
        configHome,
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const envelope = parseJson(result.stdout, TransformJobListEnvelope);
      expect(envelope.returned).toBe(envelope.data.length);
      expect(envelope.total).toBe(envelope.data.length);
      const ours = envelope.data.find((row) => row.id === created.id);
      expect(ours).toEqual({
        id: created.id,
        name: created.name,
        description: null,
        schedule: VALID_CRON,
        ui_display_type: "cron/raw",
        built_in_type: created.built_in_type ?? null,
      });
    } finally {
      await deleteJob(created.id);
    }
  });

  it("create + get round-trip returns the same job by id", async () => {
    const created = await createJob("getrt");
    try {
      const configHome = await makeIsolatedConfigHome();
      const result = await runCli({
        args: ["transform-job", "get", String(created.id), "--json"],
        configHome,
        env: authEnv(),
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TransformJobCompact)).toEqual({
        id: created.id,
        name: created.name,
        description: null,
        schedule: VALID_CRON,
        ui_display_type: "cron/raw",
        built_in_type: created.built_in_type ?? null,
      });
    } finally {
      await deleteJob(created.id);
    }
  });

  it("update changes the schedule and the change is visible via get", async () => {
    const created = await createJob("update");
    try {
      const updateConfigHome = await makeIsolatedConfigHome();
      const updateResult = await runCli({
        args: ["transform-job", "update", String(created.id), "--json"],
        stdin: JSON.stringify({ schedule: SECOND_CRON }),
        configHome: updateConfigHome,
        env: authEnv(),
      });
      expect(updateResult.exitCode, updateResult.stderr).toBe(0);
      expect(parseJson(updateResult.stdout, TransformJobCompact)).toEqual({
        id: created.id,
        name: created.name,
        description: null,
        schedule: SECOND_CRON,
        ui_display_type: "cron/raw",
        built_in_type: created.built_in_type ?? null,
      });

      const getConfigHome = await makeIsolatedConfigHome();
      const getResult = await runCli({
        args: ["transform-job", "get", String(created.id), "--json"],
        configHome: getConfigHome,
        env: authEnv(),
      });
      expect(getResult.exitCode, getResult.stderr).toBe(0);
      expect(parseJson(getResult.stdout, TransformJobCompact)).toEqual({
        id: created.id,
        name: created.name,
        description: null,
        schedule: SECOND_CRON,
        ui_display_type: "cron/raw",
        built_in_type: created.built_in_type ?? null,
      });
    } finally {
      await deleteJob(created.id);
    }
  });

  it("delete --yes removes the job; subsequent get returns 404", async () => {
    const created = await createJob("delete");

    const deleteConfigHome = await makeIsolatedConfigHome();
    const deleteResult = await runCli({
      args: ["transform-job", "delete", String(created.id), "--yes", "--json"],
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
      args: ["transform-job", "get", String(created.id), "--json"],
      configHome: getConfigHome,
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("create with body missing required schedule fails on Zod validation", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform-job", "create", "--json"],
      stdin: JSON.stringify({ name: `e2e_job_invalid_${RUN_NONCE}` }),
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
      args: ["transform-job", "get", "abc", "--json"],
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
      args: ["transform-job", "get", "9999999", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("delete without --yes and without TTY stdin fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["transform-job", "delete", "1", "--json"],
      stdin: "",
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--yes required to delete non-interactively");
    expect(result.stdout).toBe("");
  });
});

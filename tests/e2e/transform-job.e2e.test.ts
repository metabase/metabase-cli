import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteResult } from "../../src/commands/delete-runtime";
import { TransformJobListEnvelope } from "../../src/commands/transform-job/list";
import { TransformJobCompact } from "../../src/domain/transform-job";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const VALID_CRON = "0 0 0 * * ?";
const SECOND_CRON = "0 0 6 * * ?";
const JOB_NAME = "e2e_job";
const FIRST_USER_JOB_ID = 5;

const BUILT_IN_JOBS = [
  {
    id: 1,
    name: "Hourly job",
    description: "Executes transforms tagged with 'hourly' every hour",
    schedule: "0 0 * * * ? *",
    ui_display_type: "cron/builder",
    active: true,
    built_in_type: "hourly",
  },
  {
    id: 2,
    name: "Daily job",
    description: "Executes transforms tagged with 'daily' once per day",
    schedule: "0 0 0 * * ? *",
    ui_display_type: "cron/builder",
    active: true,
    built_in_type: "daily",
  },
  {
    id: 3,
    name: "Weekly job",
    description: "Executes transforms tagged with 'weekly' once per week",
    schedule: "0 0 0 ? * 1 *",
    ui_display_type: "cron/builder",
    active: true,
    built_in_type: "weekly",
  },
  {
    id: 4,
    name: "Monthly job",
    description: "Executes transforms tagged with 'monthly' once per month",
    schedule: "0 0 0 1 * ? *",
    ui_display_type: "cron/builder",
    active: true,
    built_in_type: "monthly",
  },
] as const;

const USER_JOB_COMPACT = {
  id: FIRST_USER_JOB_ID,
  name: JOB_NAME,
  description: null,
  schedule: VALID_CRON,
  ui_display_type: "cron/raw",
  active: true,
  built_in_type: null,
} as const;

interface JobBody {
  name: string;
  schedule: string;
  ui_display_type?: "cron/raw" | "cron/builder";
}

const JOB_BODY: JobBody = {
  name: JOB_NAME,
  schedule: VALID_CRON,
};

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

  async function createSeedJob(): Promise<TransformJobCompact> {
    const result = await runCli({
      args: ["transform-job", "create", "--json"],
      stdin: JSON.stringify(JOB_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, TransformJobCompact);
    expect(created).toEqual(USER_JOB_COMPACT);
    return created;
  }

  it("list returns the four built-in jobs and the just-created user job", async () => {
    await createSeedJob();

    const result = await runCli({
      args: ["transform-job", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobListEnvelope)).toEqual({
      data: [USER_JOB_COMPACT, ...BUILT_IN_JOBS],
      returned: BUILT_IN_JOBS.length + 1,
      total: BUILT_IN_JOBS.length + 1,
    });
  });

  it("create + get round-trip returns the same job by id", async () => {
    await createSeedJob();

    const result = await runCli({
      args: ["transform-job", "get", String(FIRST_USER_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobCompact)).toEqual(USER_JOB_COMPACT);
  });

  it("update changes the schedule and the change is visible via get", async () => {
    await createSeedJob();

    const updateResult = await runCli({
      args: ["transform-job", "update", String(FIRST_USER_JOB_ID), "--json"],
      stdin: JSON.stringify({ schedule: SECOND_CRON }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);
    expect(parseJson(updateResult.stdout, TransformJobCompact)).toEqual({
      ...USER_JOB_COMPACT,
      schedule: SECOND_CRON,
    });

    const getResult = await runCli({
      args: ["transform-job", "get", String(FIRST_USER_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(parseJson(getResult.stdout, TransformJobCompact)).toEqual({
      ...USER_JOB_COMPACT,
      schedule: SECOND_CRON,
    });
  });

  it("delete --yes removes the job; subsequent get returns 404", async () => {
    await createSeedJob();

    const deleteResult = await runCli({
      args: ["transform-job", "delete", String(FIRST_USER_JOB_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(deleteResult.exitCode, deleteResult.stderr).toBe(0);
    expect(parseJson(deleteResult.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_USER_JOB_ID,
    });

    const getResult = await runCli({
      args: ["transform-job", "get", String(FIRST_USER_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("create with body missing required schedule fails on Zod validation", async () => {
    const result = await runCli({
      args: ["transform-job", "create", "--json"],
      stdin: JSON.stringify({ name: "missing-schedule" }),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("request body: value did not match expected schema");
    expect(result.stdout).toBe("");
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-job", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("delete without --yes proceeds in non-TTY (auto-confirm matches kubectl/gh/docker convention)", async () => {
    await createSeedJob();

    const result = await runCli({
      args: ["transform-job", "delete", String(FIRST_USER_JOB_ID), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: FIRST_USER_JOB_ID,
    });
  });
});

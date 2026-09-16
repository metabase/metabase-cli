import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TransformJobCompact } from "@metabase/client/domain/transform-job";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { TransformJobListEnvelope } from "../../packages/cli/src/commands/transform-job/list";
import {
  TransformJobRunResult,
  type TransformJobRunResultJson,
} from "../../packages/cli/src/commands/transform-job/run";
import { TransformJobActiveResult } from "../../packages/cli/src/commands/transform-job/set-active";
import { TransformJobTransformsEnvelope } from "../../packages/cli/src/commands/transform-job/transforms";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { E2E_BUILTIN_TRANSFORM_JOBS } from "./seed/ids";
import { SEEDED } from "./seed/seeded";
import { requireServer, serverHas } from "./server-gate";

const VALID_CRON = "0 0 0 * * ?";
const SECOND_CRON = "0 0 6 * * ?";
const JOB_NAME = "e2e_job";
const FIRST_USER_JOB_ID = 5;
const HOURLY_JOB_ID = E2E_BUILTIN_TRANSFORM_JOBS.HOURLY;
const DAILY_JOB_ID = E2E_BUILTIN_TRANSFORM_JOBS.DAILY;
const DAILY_TAG_ID = 2;
const JOB_TRANSFORM_NAME = "e2e_job_transform";
const FIRST_JOB_RUN_ID = 1;
const RUN_STARTED_MESSAGE = "Job run started";

// One generation answers every run request with an opaque stub, so it reports a start it cannot
// number and cannot tell when nothing ran; the other names the run, or reports that nothing started.
const reportsRunId = serverHas("transformJobRunIdIsNumeric");

const STARTED_RUN: TransformJobRunResultJson = {
  message: RUN_STARTED_MESSAGE,
  started: true,
  run_id: reportsRunId ? FIRST_JOB_RUN_ID : null,
};

const NOTHING_TO_RUN: TransformJobRunResultJson = {
  message: RUN_STARTED_MESSAGE,
  started: !reportsRunId,
  run_id: null,
};

function startedRunText(jobId: number): string {
  return reportsRunId
    ? `Started transform job ${jobId} as run ${FIRST_JOB_RUN_ID}.`
    : `Started transform job ${jobId}.`;
}

function nothingToRunText(jobId: number): string {
  return reportsRunId
    ? `Transform job ${jobId} was not started (already running, or it resolves to no transforms).`
    : `Started transform job ${jobId}.`;
}

interface JobTransformNativeQuery {
  type: "native";
  database: number;
  native: { query: string };
}

interface JobTransformBody {
  name: string;
  source: { type: "query"; query: JobTransformNativeQuery };
  target: { type: "table"; database: number; schema: string; name: string };
  tag_ids: number[];
}

const JOB_TRANSFORM_BODY: JobTransformBody = {
  name: JOB_TRANSFORM_NAME,
  source: {
    type: "query",
    query: { type: "native", database: SEEDED.warehouseDbId, native: { query: "SELECT 1 AS one" } },
  },
  target: {
    type: "table",
    database: SEEDED.warehouseDbId,
    schema: "public",
    name: JOB_TRANSFORM_NAME,
  },
  tag_ids: [DAILY_TAG_ID],
};

// One generation provisions the output table's row at creation, so its link is live before any run.
const JOB_TRANSFORM_COMPACT = {
  id: 1,
  name: JOB_TRANSFORM_NAME,
  description: null,
  source_type: "native",
  target_db_id: SEEDED.warehouseDbId,
  target: {
    type: "table",
    database: SEEDED.warehouseDbId,
    schema: "public",
    name: JOB_TRANSFORM_NAME,
  },
  target_table_id: serverHas("transformTargetTableLinkedOnCreate") ? expect.any(Number) : null,
} as const;

const BUILT_IN_JOBS = [
  {
    id: 1,
    name: "Hourly job",
    description: "Executes transforms tagged with 'hourly' every hour",
    schedule: "0 0 * * * ? *",
    ui_display_type: "cron/builder",
    built_in_type: "hourly",
  },
  {
    id: 2,
    name: "Daily job",
    description: "Executes transforms tagged with 'daily' once per day",
    schedule: "0 0 0 * * ? *",
    ui_display_type: "cron/builder",
    built_in_type: "daily",
  },
  {
    id: 3,
    name: "Weekly job",
    description: "Executes transforms tagged with 'weekly' once per week",
    schedule: "0 0 0 ? * 1 *",
    ui_display_type: "cron/builder",
    built_in_type: "weekly",
  },
  {
    id: 4,
    name: "Monthly job",
    description: "Executes transforms tagged with 'monthly' once per month",
    schedule: "0 0 0 1 * ? *",
    ui_display_type: "cron/builder",
    built_in_type: "monthly",
  },
] as const;

const USER_JOB_COMPACT = {
  id: FIRST_USER_JOB_ID,
  name: JOB_NAME,
  description: null,
  schedule: VALID_CRON,
  ui_display_type: "cron/raw",
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

// `active` is absent before v0.61 (added by the "disable jobs" migration), so strip it
// before comparing — the field is asserted nowhere in this suite.
function withoutActive(job: TransformJobCompact): Omit<TransformJobCompact, "active"> {
  return {
    id: job.id,
    name: job.name,
    description: job.description,
    schedule: job.schedule,
    ui_display_type: job.ui_display_type,
    built_in_type: job.built_in_type,
  };
}

const skipReason = requireServer("transform-job › transform-job e2e", ["transforms"]);
const setActiveSkipReason = requireServer("transform-job › set-active", ["transformJobActivation"]);

describe.skipIf(skipReason !== null)("transform-job e2e", () => {
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

  async function createSeedJob(): Promise<TransformJobCompact> {
    const result = await runCli({
      args: ["transform-job", "create", "--json"],
      stdin: JSON.stringify(JOB_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, TransformJobCompact);
    expect(withoutActive(created)).toEqual(USER_JOB_COMPACT);
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
    const envelope = parseJson(result.stdout, TransformJobListEnvelope);
    const byId = [...envelope.data]
      .toSorted((left, right) => left.id - right.id)
      .map(withoutActive);
    expect(byId).toEqual([...BUILT_IN_JOBS, USER_JOB_COMPACT]);
    expect({ returned: envelope.returned, total: envelope.total }).toEqual({
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
    expect(withoutActive(parseJson(result.stdout, TransformJobCompact))).toEqual(USER_JOB_COMPACT);
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
    expect(withoutActive(parseJson(updateResult.stdout, TransformJobCompact))).toEqual({
      ...USER_JOB_COMPACT,
      schedule: SECOND_CRON,
    });

    const getResult = await runCli({
      args: ["transform-job", "get", String(FIRST_USER_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode, getResult.stderr).toBe(0);
    expect(withoutActive(parseJson(getResult.stdout, TransformJobCompact))).toEqual({
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
    expect(getResult.stderr).toContain(`Not found: GET /api/transform-job/${FIRST_USER_JOB_ID}.`);
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
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/transform-job/9999999.");
  });

  it("delete without --yes refuses in non-TTY and exits 2 (explicit confirmation required)", async () => {
    const result = await runCli({
      args: ["transform-job", "delete", String(FIRST_USER_JOB_ID), "--json"],
      stdin: "",
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `refusing to delete ${FIRST_USER_JOB_ID} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
  });

  async function createJobTransform(): Promise<void> {
    const result = await runCli({
      args: ["transform", "create", "--json"],
      stdin: JSON.stringify(JOB_TRANSFORM_BODY),
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("run starts a job that resolves to transforms", async () => {
    await createJobTransform();

    const result = await runCli({
      args: ["transform-job", "run", String(DAILY_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobRunResult)).toEqual(STARTED_RUN);
  });

  it("run --force-refresh starts a job that resolves to transforms", async () => {
    await createJobTransform();

    const result = await runCli({
      args: ["transform-job", "run", String(DAILY_JOB_ID), "--force-refresh", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobRunResult)).toEqual(STARTED_RUN);
  });

  it("run reports a job that resolves to no transforms", async () => {
    const result = await runCli({
      args: ["transform-job", "run", String(HOURLY_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobRunResult)).toEqual(NOTHING_TO_RUN);
  });

  it("run in text names the run it started", async () => {
    await createJobTransform();

    const result = await runCli({
      args: ["transform-job", "run", String(DAILY_JOB_ID), "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(startedRunText(DAILY_JOB_ID));
  });

  it("run in text says whether a job with no transforms started", async () => {
    const result = await runCli({
      args: ["transform-job", "run", String(HOURLY_JOB_ID), "--format", "text"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(nothingToRunText(HOURLY_JOB_ID));
  });

  it("run with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-job", "run", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("run against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "run", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: POST /api/transform-job/9999999/run.");
  });

  it("transforms lists the transforms a job resolves to by tag", async () => {
    await createJobTransform();

    const result = await runCli({
      args: ["transform-job", "transforms", String(DAILY_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobTransformsEnvelope)).toEqual({
      data: [JOB_TRANSFORM_COMPACT],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("transforms is empty for a job with no tagged transforms", async () => {
    const result = await runCli({
      args: ["transform-job", "transforms", String(HOURLY_JOB_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobTransformsEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("transforms with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-job", "transforms", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("transforms against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "transforms", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/transform-job/9999999/transforms.");
  });

  describe.skipIf(setActiveSkipReason !== null)("set-active", () => {
    it("set-active false deactivates every job", async () => {
      const result = await runCli({
        args: ["transform-job", "set-active", "false", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TransformJobActiveResult)).toEqual({
        updated: BUILT_IN_JOBS.length,
        failed: 0,
      });

      const listResult = await runCli({
        args: ["transform-job", "list", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(listResult.exitCode, listResult.stderr).toBe(0);
      const actives = parseJson(listResult.stdout, TransformJobListEnvelope).data.map(
        (job) => job.active,
      );
      expect(actives).toEqual(Array.from({ length: BUILT_IN_JOBS.length }, () => false));
    });

    it("set-active true is a no-op when every job is already active", async () => {
      const result = await runCli({
        args: ["transform-job", "set-active", "true", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TransformJobActiveResult)).toEqual({
        updated: 0,
        failed: 0,
      });
    });

    it("set-active with an invalid value fails fast with ConfigError", async () => {
      const result = await runCli({
        args: ["transform-job", "set-active", "maybe", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: authEnv(),
      });
      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toContain(
        'invalid active: "maybe" (expected one of: true, false)',
      );
      expect(result.stdout).toBe("");
    });
  });
});

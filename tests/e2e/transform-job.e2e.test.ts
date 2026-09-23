import { beforeAll, describe, expect, it } from "vitest";

import { TransformJobCompact } from "@metabase/client/domain/transform-job";
import { parseJson } from "@metabase/client/json";

import { TransformJobListEnvelope } from "../../packages/cli/src/commands/transform-job/list";
import {
  TransformJobRunResult,
  type TransformJobRunResultJson,
} from "../../packages/cli/src/commands/transform-job/run";
import { TransformJobTransformsEnvelope } from "../../packages/cli/src/commands/transform-job/transforms";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { E2E_BUILTIN_TRANSFORM_JOBS } from "./seed/ids";
import { requireServer, serverHas } from "./server-gate";

const HOURLY_JOB_ID = E2E_BUILTIN_TRANSFORM_JOBS.HOURLY;
const RUN_STARTED_MESSAGE = "Job run started";

// One generation answers every run request with an opaque stub, so it can neither number a run
// nor say whether one started; the other names the run, or reports that nothing started.
const reportsRunId = serverHas("transformJobRunIdIsNumeric");

const NOTHING_TO_RUN: TransformJobRunResultJson = {
  message: RUN_STARTED_MESSAGE,
  started: reportsRunId ? false : null,
  run_id: null,
};

function requestedRunText(jobId: number): string {
  return `Requested a run of transform job ${jobId}; this server does not say whether one started.`;
}

function nothingToRunText(jobId: number): string {
  return reportsRunId
    ? `Transform job ${jobId} was not started (already running, or it resolves to no transforms).`
    : requestedRunText(jobId);
}

const ACTIVE = { active: serverHas("transformJobActivation") ? true : null };

const HOURLY_JOB_COMPACT = {
  ...ACTIVE,
  id: HOURLY_JOB_ID,
  name: "Hourly job",
  description: "Executes transforms tagged with 'hourly' every hour",
  schedule: "0 0 * * * ? *",
  ui_display_type: "cron/builder",
  built_in_type: "hourly",
} as const;

const BUILT_IN_JOBS = [
  HOURLY_JOB_COMPACT,
  {
    ...ACTIVE,
    id: 2,
    name: "Daily job",
    description: "Executes transforms tagged with 'daily' once per day",
    schedule: "0 0 0 * * ? *",
    ui_display_type: "cron/builder",
    built_in_type: "daily",
  },
  {
    ...ACTIVE,
    id: 3,
    name: "Weekly job",
    description: "Executes transforms tagged with 'weekly' once per week",
    schedule: "0 0 0 ? * 1 *",
    ui_display_type: "cron/builder",
    built_in_type: "weekly",
  },
  {
    ...ACTIVE,
    id: 4,
    name: "Monthly job",
    description: "Executes transforms tagged with 'monthly' once per month",
    schedule: "0 0 0 1 * ? *",
    ui_display_type: "cron/builder",
    built_in_type: "monthly",
  },
] as const;

const skipReason = requireServer("transform-job › transform-job e2e", ["transforms"]);

describe.skipIf(skipReason !== null)("transform-job e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list returns the four built-in jobs on a fresh restore", async () => {
    const result = await runCli({
      args: ["transform-job", "list", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, TransformJobListEnvelope);
    expect({
      ...envelope,
      data: [...envelope.data].toSorted((left, right) => left.id - right.id),
    }).toEqual({
      data: [...BUILT_IN_JOBS],
      returned: BUILT_IN_JOBS.length,
      offset: 0,
      total: BUILT_IN_JOBS.length,
      has_more: false,
      next_offset: null,
    });
  });

  it("get returns the built-in hourly job by id", async () => {
    const result = await runCli({
      args: ["transform-job", "get", String(HOURLY_JOB_ID), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobCompact)).toEqual(HOURLY_JOB_COMPACT);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-job", "get", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "get", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: GET /api/transform-job/9999999.");
  });

  it("run reports a job that resolves to no transforms", async () => {
    const result = await runCli({
      args: ["transform-job", "run", String(HOURLY_JOB_ID), "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TransformJobRunResult)).toEqual(NOTHING_TO_RUN);
  });

  it("run in text says whether a job with no transforms started", async () => {
    const result = await runCli({
      args: ["transform-job", "run", String(HOURLY_JOB_ID), "--format", "text"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(nothingToRunText(HOURLY_JOB_ID));
  });

  it("run with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["transform-job", "run", "abc", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("run against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "run", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: POST /api/transform-job/9999999/run.");
  });

  it("transforms is empty for a job with no tagged transforms", async () => {
    const result = await runCli({
      args: ["transform-job", "transforms", String(HOURLY_JOB_ID), "--json"],
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
      env: authEnv(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("transforms against a missing id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["transform-job", "transforms", "9999999", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(
      "Not found: GET /api/transform-job/9999999/transforms.",
    );
  });
});

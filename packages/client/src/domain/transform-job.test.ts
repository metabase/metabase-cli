import { describe, expect, it } from "vitest";

import { evaluateFeatures } from "../version/features";

import { transformJobRunResultSchema, transformJobSchema } from "./transform-job";

const ALWAYS_ACTIVE_SERVER = evaluateFeatures(58, null);
const STUB_RUN_ID_SERVER = evaluateFeatures(61, null);
const NUMERIC_RUN_ID_SERVER = evaluateFeatures(64, null);

const RUN_STARTED_MESSAGE = "Job run started";

const JOB_WIRE = {
  id: 3,
  name: "Nightly",
  description: null,
  schedule: "0 0 0 * * ?",
  ui_display_type: "cron/raw",
  entity_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("transformJobSchema", () => {
  it("reads a job from a server that cannot switch jobs off with active null", () => {
    expect(transformJobSchema(ALWAYS_ACTIVE_SERVER).parse(JOB_WIRE)).toEqual({
      ...JOB_WIRE,
      active: null,
    });
  });

  it("requires active from a server that can switch jobs off", () => {
    expect(transformJobSchema(STUB_RUN_ID_SERVER).safeParse(JOB_WIRE).success).toBe(false);
  });
});

describe("transformJobRunResultSchema", () => {
  it("reads an opaque stub id as an accepted request whose outcome the server cannot say", () => {
    expect(
      transformJobRunResultSchema(STUB_RUN_ID_SERVER).parse({
        message: RUN_STARTED_MESSAGE,
        job_run_id: "stub-3-1767225600000",
      }),
    ).toEqual({ message: RUN_STARTED_MESSAGE, started: null, run_id: null });
  });

  it("reads a numeric run id as a start with that id", () => {
    expect(
      transformJobRunResultSchema(NUMERIC_RUN_ID_SERVER).parse({
        message: RUN_STARTED_MESSAGE,
        job_run_id: 11,
      }),
    ).toEqual({ message: RUN_STARTED_MESSAGE, started: true, run_id: 11 });
  });

  it("reads a null run id as nothing started", () => {
    expect(
      transformJobRunResultSchema(NUMERIC_RUN_ID_SERVER).parse({
        message: RUN_STARTED_MESSAGE,
        job_run_id: null,
      }),
    ).toEqual({ message: RUN_STARTED_MESSAGE, started: false, run_id: null });
  });
});

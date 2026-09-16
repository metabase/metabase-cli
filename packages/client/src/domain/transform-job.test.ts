import { describe, expect, it } from "vitest";

import { evaluateFeatures } from "../version/features";

import { transformJobRunResultSchema } from "./transform-job";

const STUB_RUN_ID_SERVER = evaluateFeatures(61, null);
const NUMERIC_RUN_ID_SERVER = evaluateFeatures(64, null);

const RUN_STARTED_MESSAGE = "Job run started";

describe("transformJobRunResultSchema", () => {
  it("reads an opaque stub id as a start whose run id the server cannot say", () => {
    expect(
      transformJobRunResultSchema(STUB_RUN_ID_SERVER).parse({
        message: RUN_STARTED_MESSAGE,
        job_run_id: "stub-3-1767225600000",
      }),
    ).toEqual({ message: RUN_STARTED_MESSAGE, started: true, run_id: null });
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

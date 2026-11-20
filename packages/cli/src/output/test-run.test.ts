import { describe, expect, it } from "vitest";

import type {
  DataTestExpectationResult,
  DataTestRunDetail,
  DataTestRunResult,
} from "@metabase/client/domain/data-test";

import { storedResultSummary, testRunSummary } from "./test-run";

const PASSED: DataTestExpectationResult = {
  name: "no negatives",
  type: "empty",
  status: "passed",
};
const FAILED: DataTestExpectationResult = {
  name: "totals add up",
  type: "empty",
  status: "failed",
  columns: [],
  sample: [],
  truncated: 0,
};
const ERRORED: DataTestExpectationResult = {
  name: "unique ids",
  type: "empty",
  status: "error",
  error: { type: "expectation-failed", message: "boom" },
};

function run(
  status: DataTestRunResult["status"],
  expectations: DataTestRunResult["expectations"],
): DataTestRunResult {
  return { status, expectations, tables: {} };
}

describe("testRunSummary", () => {
  it("counts the expectations of a run that passed", () => {
    expect(testRunSummary("card-test:34", run("passed", [PASSED, PASSED]))).toBe(
      "card-test:34 passed 2 expectations.",
    );
  });

  it("names the expectations that failed and the ones that could not run", () => {
    expect(testRunSummary("card-test:34", run("failed", [PASSED, FAILED, ERRORED]))).toBe(
      "card-test:34 failed — failed: totals add up; could not run: unique ids.",
    );
  });

  it("prints expectation names escaped, so a name cannot forge a line", () => {
    const forged = { ...FAILED, name: "totals\nPASSED" };

    expect(testRunSummary("card-test:34", run("failed", [forged]))).toBe(
      "card-test:34 failed — failed: totals\\u000aPASSED.",
    );
  });

  it("gives the bare status of a run that did not pass with no expectation to name", () => {
    expect(testRunSummary("card-test:34", run("error", []))).toBe("card-test:34 error.");
  });
});

function stored(fields: Pick<DataTestRunDetail, "result" | "can_read_result">): DataTestRunDetail {
  return {
    id: 31,
    test_type: "card",
    test_id: 34,
    status: "failed",
    start_time: "2026-01-01T00:00:00Z",
    end_time: "2026-01-01T00:00:01Z",
    initiated_by: 1,
    last_heartbeat: "2026-01-01T00:00:00Z",
    ...fields,
  };
}

describe("storedResultSummary", () => {
  it("summarizes the stored result under the test the run belongs to", () => {
    const result = run("failed", [PASSED, FAILED]);

    expect(storedResultSummary(stored({ result, can_read_result: true }))).toBe(
      "card-test:34 failed — failed: totals add up.",
    );
  });

  it("gives the message and error code of a run that was refused", () => {
    const result = { message: "The card has no query.", "error-code": "card-has-no-query" };

    expect(storedResultSummary(stored({ result, can_read_result: true }))).toBe(
      "The card has no query. (card-has-no-query)",
    );
  });

  it("says a readable run stored no result", () => {
    expect(storedResultSummary(stored({ result: null, can_read_result: true }))).toBe(
      "none stored",
    );
  });

  it("says the result is withheld from a caller who may not read it", () => {
    expect(storedResultSummary(stored({ result: null, can_read_result: false }))).toBe(
      "withheld from this user",
    );
  });
});

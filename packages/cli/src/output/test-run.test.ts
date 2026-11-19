import { describe, expect, it } from "vitest";

import type {
  DataTestExpectationResult,
  DataTestRunResult,
} from "@metabase/client/domain/data-test";

import { testRunSummary } from "./test-run";

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

  it("gives the bare status of a run that did not pass with no expectation to name", () => {
    expect(testRunSummary("card-test:34", run("error", []))).toBe("card-test:34 error.");
  });
});

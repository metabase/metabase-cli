import { describe, expect, it } from "vitest";

import type { LintReport } from "@metabase/client/domain/lint";

import type { CheckOutcome } from "../../core/ci-events";
import { lintStage } from "./lint-stage";

const CLEAN_REPORT: LintReport = {
  status: "passed",
  summary: { errors: 0, warnings: 0, entities: 0 },
  entities: {},
  rules: {},
  results: [],
};

// Answers each reading in turn, so a test fixes how long the report took.
function clock(...readings: number[]): () => number {
  const remaining = [...readings];
  return () => {
    const next = remaining.shift();
    if (next === undefined) {
      throw new Error("the clock was read more often than the test expects");
    }
    return next;
  };
}

describe("lintStage", () => {
  it("reports how long the report took on the instance's check", async () => {
    const checks: CheckOutcome[] = [];
    const stage = lintStage(async () => ({
      readReport: async () => CLEAN_REPORT,
      nowMs: clock(10, 52),
    }));

    expect(await stage.run((check) => checks.push(check))).toBeNull();
    expect(checks).toEqual([
      {
        check: { kind: "broken-refs", id: "instance", label: "Entities on the instance" },
        verdict: "passed",
        warnings: [],
        ms: 42,
        detail: CLEAN_REPORT.summary,
      },
    ]);
  });

  it("rethrows an error outside the client's failures, since it is a bug", async () => {
    const bug = new Error("undefined is not a function");
    const stage = lintStage(async () => ({
      readReport: async () => Promise.reject(bug),
      nowMs: clock(10),
    }));

    await expect(stage.run(() => undefined)).rejects.toBe(bug);
  });
});

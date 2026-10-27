import { describe, expect, it } from "vitest";

import type {
  TransformTestExpectationResult,
  TransformTestRow,
} from "@metabase/client/domain/transform-test";

import type { CiEvent } from "./ci-events";
import { capEventRows } from "./ci-row-cap";

const ENVELOPE = { seq: 5, job: "job-1", at: "2026-10-27T12:00:00.000Z" };

function rows(count: number): TransformTestRow[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

function unitCheck(detail: unknown): CiEvent {
  return {
    ...ENVELOPE,
    type: "check.result",
    stage: "unit",
    check: { kind: "transform-test", id: "1", label: "orders: order rules" },
    verdict: "failed",
    warnings: [],
    ms: 250,
    detail,
  };
}

function runOf(expectation: TransformTestExpectationResult): unknown {
  return { status: "failed", tables: {}, expectations: [expectation] };
}

interface EqualsRows {
  missing: TransformTestRow[];
  extra: TransformTestRow[];
  truncated: number;
}

function equalsFailure(found: EqualsRows): TransformTestExpectationResult {
  return {
    name: "one row per order",
    type: "equals",
    status: "failed",
    columns: [{ name: "id", database_type: "int8" }],
    "row-counts": { actual: 20, expected: 19 },
    "missing-rows": found.missing,
    "extra-rows": found.extra,
    "cell-mismatches": [],
    truncated: found.truncated,
  };
}

describe("capEventRows", () => {
  it("cuts each row list over the cap and adds the cut rows to the server's truncated", () => {
    const event = unitCheck(
      runOf(equalsFailure({ missing: rows(4), extra: rows(7), truncated: 10 })),
    );

    expect(capEventRows(event, 2)).toEqual(
      unitCheck(runOf(equalsFailure({ missing: rows(2), extra: rows(2), truncated: 17 }))),
    );
  });

  it("leaves row lists at or under the cap as they are", () => {
    const event = unitCheck(
      runOf(equalsFailure({ missing: rows(2), extra: rows(1), truncated: 0 })),
    );

    expect(capEventRows(event, 2)).toEqual(event);
  });

  it("keeps no rows at a cap of 0, counting them all", () => {
    const event = unitCheck(
      runOf(equalsFailure({ missing: rows(3), extra: rows(1), truncated: 0 })),
    );

    expect(capEventRows(event, 0)).toEqual(
      unitCheck(runOf(equalsFailure({ missing: [], extra: [], truncated: 4 }))),
    );
  });

  it("cuts an empty expectation's sample and adds the cut rows to its truncated", () => {
    const sample = (count: number, truncated: number): TransformTestExpectationResult => ({
      name: "no negative totals",
      type: "empty",
      status: "failed",
      columns: [{ name: "id", database_type: "int8" }],
      sample: rows(count),
      truncated,
    });

    expect(capEventRows(unitCheck(runOf(sample(6, 1))), 2)).toEqual(unitCheck(runOf(sample(2, 5))));
  });

  it("counts the cell mismatches it cuts in cell-mismatches-truncated", () => {
    const mismatch = { column: "status", expected: "paid", actual: "refunded" };
    const withMismatches = (count: number): TransformTestExpectationResult => ({
      ...equalsFailure({ missing: [], extra: [], truncated: 0 }),
      "cell-mismatches": Array.from({ length: count }, () => mismatch),
    });

    expect(capEventRows(unitCheck(runOf(withMismatches(3))), 1)).toEqual(
      unitCheck(runOf({ ...withMismatches(1), "cell-mismatches-truncated": 2 })),
    );
  });

  it("leaves a check that is not a transform test as it is", () => {
    const coverage: CiEvent = {
      ...ENVELOPE,
      type: "check.result",
      stage: "lint",
      check: { kind: "coverage", id: "untouched", label: "Untouched transforms" },
      verdict: "passed",
      warnings: [],
      ms: 0,
      detail: { untested: rows(3) },
    };

    expect(capEventRows(coverage, 1)).toEqual(coverage);
  });

  it("leaves a transform test's refusal as it is", () => {
    const refused = unitCheck({
      error_code: "transform-test.unknown-column",
      message: "input orders has no column named total",
    });

    expect(capEventRows(refused, 0)).toEqual(refused);
  });
});

import {
  type TransformTestExpectationResult,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";

import type { CiEvent } from "./ci-events";

export const DEFAULT_MAX_ROWS = 5;

// A CI log is readable by everyone who can read the repo, and a transform test's rows can come
// from warehouse tables. So the stream keeps at most `maxRows` of each row list, and counts the
// rest: dropped rows join the server's own `truncated`, and dropped cell mismatches, which the
// server never caps, get a count of their own.
export function capEventRows(event: CiEvent, maxRows: number): CiEvent {
  if (event.type !== "check.result" || event.check.kind !== "transform-test") {
    return event;
  }
  const result = TransformTestRunResult.safeParse(event.detail);
  if (!result.success) {
    return event;
  }
  const expectations = result.data.expectations.map((expectation) =>
    capExpectation(expectation, maxRows),
  );
  return { ...event, detail: { ...result.data, expectations } };
}

function capExpectation(
  result: TransformTestExpectationResult,
  maxRows: number,
): TransformTestExpectationResult {
  if (result.status === "error") {
    return result;
  }
  if (result.type === "empty") {
    if (result.status === "passed") {
      return result;
    }
    return {
      ...result,
      sample: result.sample.slice(0, maxRows),
      truncated: result.truncated + droppedBy(result.sample, maxRows),
    };
  }
  const extra = result["extra-rows"];
  const missing = result["missing-rows"];
  const mismatches = result["cell-mismatches"];
  const capped = {
    ...result,
    "extra-rows": extra.slice(0, maxRows),
    "missing-rows": missing.slice(0, maxRows),
    "cell-mismatches": mismatches.slice(0, maxRows),
    truncated: result.truncated + droppedBy(extra, maxRows) + droppedBy(missing, maxRows),
  };
  const droppedMismatches = droppedBy(mismatches, maxRows);
  if (droppedMismatches === 0) {
    return capped;
  }
  return { ...capped, "cell-mismatches-truncated": droppedMismatches };
}

function droppedBy(rows: readonly unknown[], maxRows: number): number {
  return Math.max(rows.length - maxRows, 0);
}

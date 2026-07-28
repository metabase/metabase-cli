import { describe, expect, it } from "vitest";

import { isTransformRunFailed, isTransformRunTerminal, type TransformRunStatus } from "./transform";

const ALL_STATUSES: TransformRunStatus[] = [
  "started",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "canceling",
];

describe("isTransformRunTerminal", () => {
  it("returns false for the two in-flight statuses, started and canceling", () => {
    const terminal = ALL_STATUSES.filter((status) => isTransformRunTerminal(status));
    expect(terminal).toEqual(["succeeded", "failed", "timeout", "canceled"]);
  });
});

describe("isTransformRunFailed", () => {
  it("returns true only for failed, timeout, and canceled (not succeeded)", () => {
    const failures = ALL_STATUSES.filter((status) => isTransformRunFailed(status));
    expect(failures).toEqual(["failed", "timeout", "canceled"]);
  });
});

import { describe, expect, it } from "vitest";

import type { SyncTaskStatus } from "../../domain/remote-sync";

import { isFailure, isTerminal } from "./poll-task";

const ALL_STATUSES: SyncTaskStatus[] = [
  "running",
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
];

describe("isTerminal", () => {
  it("returns false only for the running status", () => {
    const terminal = ALL_STATUSES.filter((status) => isTerminal(status));
    expect(terminal).toEqual(["successful", "errored", "cancelled", "timed-out", "conflict"]);
  });
});

describe("isFailure", () => {
  it("returns true only for errored, timed-out, and conflict (not successful or cancelled)", () => {
    const failures = ALL_STATUSES.filter((status) => isFailure(status));
    expect(failures).toEqual(["errored", "timed-out", "conflict"]);
  });
});

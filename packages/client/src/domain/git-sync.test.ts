import { describe, expect, it } from "vitest";

import { isSyncTaskFailed, isSyncTaskTerminal, type SyncTaskStatus } from "./git-sync";

const ALL_STATUSES: SyncTaskStatus[] = [
  "running",
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
];

describe("isSyncTaskTerminal", () => {
  it("returns false only for the running status", () => {
    const terminal = ALL_STATUSES.filter((status) => isSyncTaskTerminal(status));
    expect(terminal).toEqual(["successful", "errored", "cancelled", "timed-out", "conflict"]);
  });
});

describe("isSyncTaskFailed", () => {
  it("returns true only for errored, timed-out, and conflict (not successful or cancelled)", () => {
    const failures = ALL_STATUSES.filter((status) => isSyncTaskFailed(status));
    expect(failures).toEqual(["errored", "timed-out", "conflict"]);
  });
});

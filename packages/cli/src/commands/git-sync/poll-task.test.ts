import { describe, expect, it } from "vitest";

import { SyncTask, type SyncTaskStatus } from "../../domain/git-sync";

import { formatSyncTask, isFailure, isTerminal } from "./poll-task";

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

describe("formatSyncTask", () => {
  function task(overrides: Partial<SyncTask>): SyncTask {
    return SyncTask.parse({
      id: 3,
      sync_task_type: "export",
      status: "running",
      progress: null,
      started_at: "2026-05-21T00:00:00Z",
      ...overrides,
    });
  }

  it("renders a running export with its progress as a rounded percent", () => {
    expect(formatSyncTask(task({ status: "running", progress: 0.45 }))).toBe(
      "Export task #3 is running (45%).",
    );
  });

  it("omits the percent when a running task reports no progress", () => {
    expect(formatSyncTask(task({ sync_task_type: "import", id: 7, progress: null }))).toBe(
      "Import task #7 is running.",
    );
  });

  it("renders a succeeded task", () => {
    expect(formatSyncTask(task({ status: "successful" }))).toBe("Export task #3 succeeded.");
  });

  it("appends the error message for an errored task", () => {
    expect(formatSyncTask(task({ status: "errored", error_message: "remote rejected" }))).toBe(
      "Export task #3 errored: remote rejected.",
    );
  });

  it("renders a cancelled task without an error suffix", () => {
    expect(formatSyncTask(task({ sync_task_type: "import", id: 5, status: "cancelled" }))).toBe(
      "Import task #5 was cancelled.",
    );
  });
});

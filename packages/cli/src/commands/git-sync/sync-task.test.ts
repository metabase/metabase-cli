import { describe, expect, it } from "vitest";

import { SyncTask } from "@metabase/client/domain/git-sync";

import { formatSyncTask, throwIfFailedTask } from "./sync-task";

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

describe("formatSyncTask", () => {
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

describe("throwIfFailedTask", () => {
  it("throws with the verb, the status and the server's message for a failed task", () => {
    expect(() =>
      throwIfFailedTask(task({ status: "errored", error_message: "remote rejected" }), "export"),
    ).toThrow("git-sync export errored: remote rejected");
  });

  it("throws without a detail suffix when the server reported no message", () => {
    expect(() => throwIfFailedTask(task({ status: "conflict" }), "import")).toThrow(
      "git-sync import conflict",
    );
  });

  it("does not throw for a cancelled task, which is not a failure", () => {
    expect(() => throwIfFailedTask(task({ status: "cancelled" }), "task")).not.toThrow();
  });

  it("does not throw when the server has no task at all", () => {
    expect(() => throwIfFailedTask(null, "task")).not.toThrow();
  });
});

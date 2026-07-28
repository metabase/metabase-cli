import { z } from "zod";

import { isSyncTaskFailed, SyncTask } from "@metabase/client/domain/git-sync";
import type { PollOptions } from "@metabase/client/poll";

import type { ResourceView } from "../../output/view";
import type { WaitSchedule } from "../wait-flags";

export const SyncTaskIdle = z.object({ status: z.literal("idle") });
export type SyncTaskIdle = z.infer<typeof SyncTaskIdle>;

export const SyncTaskOrIdle = z.union([SyncTask, SyncTaskIdle]);
export type SyncTaskOrIdle = z.infer<typeof SyncTaskOrIdle>;

export const syncTaskIdleView: ResourceView<SyncTaskIdle> = {
  compactPick: SyncTaskIdle,
  tableColumns: [{ key: "status", label: "Status" }],
};

// A sync of a large instance runs for minutes and reports the same status for most of them, so the
// wait backs off rather than spending a request per interval on an answer that will not have moved.
export function taskPollOptions(schedule: WaitSchedule): PollOptions {
  return { ...schedule, backoff: "exponential" };
}

export function throwIfFailedTask(final: SyncTask | null, verb: string): void {
  if (final === null || !isSyncTaskFailed(final.status)) {
    return;
  }
  const detail = final.error_message ? `: ${final.error_message}` : "";
  throw new Error(`git-sync ${verb} ${final.status}${detail}`);
}

export function formatSyncTask(task: SyncTask): string {
  const kind = task.sync_task_type === "export" ? "Export" : "Import";
  const label = `${kind} task #${task.id}`;
  const detail = task.error_message ? `: ${task.error_message}` : "";
  switch (task.status) {
    case "running": {
      const percent = task.progress === null ? "" : ` (${Math.round(task.progress * 100)}%)`;
      return `${label} is running${percent}.`;
    }
    case "successful": {
      return `${label} succeeded.`;
    }
    case "errored": {
      return `${label} errored${detail}.`;
    }
    case "timed-out": {
      return `${label} timed out${detail}.`;
    }
    case "conflict": {
      return `${label} hit conflicts${detail}.`;
    }
    case "cancelled": {
      return `${label} was cancelled.`;
    }
  }
}

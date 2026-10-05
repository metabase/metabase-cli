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

// Some servers record the remote commit a conflicted task saw as the last sync, so after a conflict
// neither a retry nor a merge detects the remote's changes any more, and the server version cannot
// tell which: the fix is being backported to patch releases.
const CONFLICT_REMEDY =
  "The server may now count the remote's commit as synced, so a retry, --merge included, may not see its changes: keep one side with import --force or export --force, or push Metabase's side to a new branch with create-branch then export, reload it with import --force, merge that branch in git, then switch back with import --branch <original>.";

// A plain export that finds the remote moved on ends in conflict with no entity to name: the
// divergence itself is the conflict.
const DIVERGED_EXPORT = "the remote branch moved past the last sync";

export function throwIfFailedTask(final: SyncTask | null, verb: string): void {
  if (final === null || !isSyncTaskFailed(final.status)) {
    return;
  }
  const failure = withDetail(`git-sync ${verb} ${final.status}`, taskDetail(final));
  if (final.status === "conflict") {
    throw new Error(`${sentence(failure)} ${CONFLICT_REMEDY}`);
  }
  throw new Error(failure);
}

// A task that ends in conflict carries no error message: the labels of the entities it conflicted
// on are its only account of what went wrong.
function taskDetail(task: SyncTask): string | null {
  if (task.error_message) {
    return task.error_message;
  }
  const conflicts = task.conflicts ?? null;
  if (conflicts !== null && conflicts.length > 0) {
    return conflicts.join("; ");
  }
  if (task.status === "conflict" && task.sync_task_type === "export") {
    return DIVERGED_EXPORT;
  }
  return null;
}

function withDetail(head: string, detail: string | null): string {
  return detail === null ? head : `${head}: ${detail}`;
}

// Server messages and conflict labels may already end a sentence.
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

export function formatSyncTask(task: SyncTask): string {
  const kind = task.sync_task_type === "export" ? "Export" : "Import";
  const label = `${kind} task #${task.id}`;
  const detail = taskDetail(task);
  switch (task.status) {
    case "running": {
      const percent = task.progress === null ? "" : ` (${Math.round(task.progress * 100)}%)`;
      return `${label} is running${percent}.`;
    }
    case "successful": {
      return `${label} succeeded.`;
    }
    case "errored": {
      return sentence(withDetail(`${label} errored`, detail));
    }
    case "timed-out": {
      return sentence(withDetail(`${label} timed out`, detail));
    }
    case "conflict": {
      return sentence(withDetail(`${label} hit conflicts`, detail));
    }
    case "cancelled": {
      return `${label} was cancelled.`;
    }
  }
}

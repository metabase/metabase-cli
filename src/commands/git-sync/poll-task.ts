import { z, type ZodType } from "zod";

import { SyncTask, type SyncTaskStatus } from "../../domain/git-sync";
import type { Client } from "../../core/http/client";
import type { ResourceView } from "../../domain/view";
import { parseJsonOrPlain } from "../../runtime/json";
import { pollUntil, type PollOptions } from "../../runtime/poll";

const TERMINAL_STATUSES = new Set<SyncTaskStatus>([
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
]);

const FAILURE_STATUSES = new Set<SyncTaskStatus>(["errored", "timed-out", "conflict"]);

export const REMOTE_SYNC_PATHS = {
  currentTask: "/api/ee/remote-sync/current-task",
  cancelTask: "/api/ee/remote-sync/current-task/cancel",
  isDirty: "/api/ee/remote-sync/is-dirty",
  hasRemoteChanges: "/api/ee/remote-sync/has-remote-changes",
  dirty: "/api/ee/remote-sync/dirty",
  import: "/api/ee/remote-sync/import",
  export: "/api/ee/remote-sync/export",
  stash: "/api/ee/remote-sync/stash",
  branches: "/api/ee/remote-sync/branches",
  createBranch: "/api/ee/remote-sync/create-branch",
  settings: "/api/ee/remote-sync/settings",
} as const;

export const SyncTaskIdle = z.object({ status: z.literal("idle") });
export type SyncTaskIdle = z.infer<typeof SyncTaskIdle>;

export const SyncTaskOrIdle = z.union([SyncTask, SyncTaskIdle]);
export type SyncTaskOrIdle = z.infer<typeof SyncTaskOrIdle>;

export const syncTaskIdleView: ResourceView<SyncTaskIdle> = {
  compactPick: SyncTaskIdle,
  tableColumns: [{ key: "status", label: "Status" }],
};

export function isTerminal(status: SyncTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isFailure(status: SyncTaskStatus): boolean {
  return FAILURE_STATUSES.has(status);
}

export async function fetchOptionalParsed<T>(
  client: Client,
  path: string,
  schema: ZodType<T>,
): Promise<T | null> {
  const response = await client.requestRaw(path, { method: "GET", expectContentType: "binary" });
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  return parseJsonOrPlain(text, response.headers.get("content-type"), schema, {
    source: response.url,
  });
}

export async function fetchCurrentTask(client: Client): Promise<SyncTask | null> {
  return await fetchOptionalParsed(client, REMOTE_SYNC_PATHS.currentTask, SyncTask);
}

export async function pollSyncTask(client: Client, opts: PollOptions): Promise<SyncTask | null> {
  return await pollUntil(
    async () => fetchCurrentTask(client),
    (task) => task === null || isTerminal(task.status),
    { backoff: "exponential", ...opts },
  );
}

export function throwIfFailedTask(final: SyncTask | null, verb: string): void {
  if (final === null || !isFailure(final.status)) {
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

import { z } from "zod";

export const SyncTaskStatus = z.enum([
  "running",
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
]);
export type SyncTaskStatus = z.infer<typeof SyncTaskStatus>;

export const SyncTaskType = z.enum(["import", "export"]);
export type SyncTaskType = z.infer<typeof SyncTaskType>;

const TERMINAL_STATUSES = new Set<SyncTaskStatus>([
  "successful",
  "errored",
  "cancelled",
  "timed-out",
  "conflict",
]);

const FAILED_STATUSES = new Set<SyncTaskStatus>(["errored", "timed-out", "conflict"]);

/** Whether the server will report any further progress for a task in this status. */
export function isSyncTaskTerminal(status: SyncTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Whether a terminal status means the sync did not carry out what it was asked to. */
export function isSyncTaskFailed(status: SyncTaskStatus): boolean {
  return FAILED_STATUSES.has(status);
}

export const SyncTask = z
  .object({
    id: z.number().int().positive(),
    sync_task_type: SyncTaskType,
    status: SyncTaskStatus,
    progress: z.number().min(0).max(1).nullable(),
    started_at: z.string(),
    ended_at: z.string().nullable().optional(),
    last_progress_report_at: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    initiated_by: z.number().int().positive().nullable().optional(),
    cancelled: z.boolean().nullable().optional(),
    error_message: z.string().nullable().optional(),
    conflicts: z.array(z.string()).nullable().optional(),
  })
  .loose();
export type SyncTask = z.infer<typeof SyncTask>;

export const SyncTaskCompact = SyncTask.pick({
  id: true,
  sync_task_type: true,
  status: true,
  progress: true,
  version: true,
  error_message: true,
}).strip();
export type SyncTaskCompact = z.infer<typeof SyncTaskCompact>;

// `final` is present only when the caller asked to wait, and null when the server had already
// forgotten the task by the time the poll ran.
export const SyncImportResult = z.object({
  message: z.string().nullable(),
  task_id: z.number().int().positive().nullable(),
  final: SyncTask.nullable().optional(),
});
export type SyncImportResult = z.infer<typeof SyncImportResult>;

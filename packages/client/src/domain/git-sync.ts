import { z } from "zod";

import { CollectionItemModel } from "./collection";

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

export const SyncDirtyItem = z
  .object({
    id: z.number().int(),
    name: z.string().nullable(),
    model: z.string(),
    sync_status: z.string(),
    collection_id: z.number().int().positive().nullable().optional(),
    description: z.string().nullable().optional(),
    display: z.string().nullable().optional(),
    query_type: z.string().nullable().optional(),
    table_id: z.number().int().positive().nullable().optional(),
    table_name: z.string().nullable().optional(),
  })
  .loose();
export type SyncDirtyItem = z.infer<typeof SyncDirtyItem>;

export const SyncDirtyItemCompact = SyncDirtyItem.pick({
  id: true,
  name: true,
  model: true,
  sync_status: true,
  collection_id: true,
}).strip();
export type SyncDirtyItemCompact = z.infer<typeof SyncDirtyItemCompact>;

export const SyncRemoteChanges = z.object({
  has_changes: z.boolean(),
  remote_version: z.string().nullable(),
  local_version: z.string().nullable(),
  cached: z.boolean(),
});
export type SyncRemoteChanges = z.infer<typeof SyncRemoteChanges>;

export const SyncMergeSummary = z.object({
  added: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
});
export type SyncMergeSummary = z.infer<typeof SyncMergeSummary>;

export const SyncForcePushCasualties = z.object({
  deleted: z.array(z.string()),
  overwritten: z.array(z.string()),
});
export type SyncForcePushCasualties = z.infer<typeof SyncForcePushCasualties>;

// `reason` names why no merge is possible; the server has one such cause, and `null` when a merge
// base exists.
export const SyncExportPreflight = z.object({
  has_changes: z.boolean(),
  clean: z.boolean(),
  conflicts: z.array(z.string()),
  summary: SyncMergeSummary,
  force_push_casualties: SyncForcePushCasualties,
  reason: z.literal("history-rewritten").nullable(),
});
export type SyncExportPreflight = z.infer<typeof SyncExportPreflight>;

export const SyncBranchCreated = z.object({
  status: z.literal("success"),
  message: z.string(),
});
export type SyncBranchCreated = z.infer<typeof SyncBranchCreated>;

export const SyncSettingsUpdateResult = z.object({
  success: z.boolean(),
  task_id: z.number().int().positive().optional(),
});
export type SyncSettingsUpdateResult = z.infer<typeof SyncSettingsUpdateResult>;

// `final` is present only when the caller asked to wait, and null when the server had already
// forgotten the task by the time the poll ran.
export const SyncImportResult = z.object({
  message: z.string().nullable(),
  task_id: z.number().int().positive().nullable(),
  final: SyncTask.nullable().optional(),
});
export type SyncImportResult = z.infer<typeof SyncImportResult>;

export const SyncExportResult = z.object({
  message: z.string(),
  task_id: z.number().int().positive(),
  final: SyncTask.nullable().optional(),
});
export type SyncExportResult = z.infer<typeof SyncExportResult>;

export const SyncStashResult = z.object({
  status: z.literal("success"),
  message: z.string(),
  task_id: z.number().int().positive(),
  final: SyncTask.nullable().optional(),
});
export type SyncStashResult = z.infer<typeof SyncStashResult>;

// A child collection is a node of the tree rather than an item of its parent, and a published table
// is identified in the repository by its database path, not by an entity id.
export const SyncTreeItemModel = CollectionItemModel.exclude(["collection", "table"]);
export type SyncTreeItemModel = z.infer<typeof SyncTreeItemModel>;

export const SyncTreeItem = z.object({
  id: z.number().int(),
  entity_id: z.string(),
  name: z.string(),
  model: SyncTreeItemModel,
});
export type SyncTreeItem = z.infer<typeof SyncTreeItem>;

// `parent_id` names the parent only when the parent is synced too; `null` marks a synced root.
export const SyncTreeCollection = z.object({
  id: z.number().int(),
  entity_id: z.string(),
  name: z.string(),
  parent_id: z.number().int().nullable(),
  items: z.array(SyncTreeItem),
});
export type SyncTreeCollection = z.infer<typeof SyncTreeCollection>;

export const SyncTree = z.object({ collections: z.array(SyncTreeCollection) });
export type SyncTree = z.infer<typeof SyncTree>;

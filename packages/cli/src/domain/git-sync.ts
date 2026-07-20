import { z } from "zod";

import type { ResourceView } from "./view";

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

export const syncTaskView: ResourceView<SyncTask> = {
  compactPick: SyncTaskCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "sync_task_type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "progress", label: "Progress" },
    { key: "version", label: "Version" },
    { key: "error_message", label: "Error" },
  ],
};

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

export const syncDirtyItemView: ResourceView<SyncDirtyItem> = {
  compactPick: SyncDirtyItemCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "model", label: "Model" },
    { key: "name", label: "Name" },
    { key: "sync_status", label: "Status" },
    { key: "collection_id", label: "Collection" },
  ],
};

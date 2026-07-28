import {
  SyncBranchCreated,
  type SyncDirtyItem,
  SyncDirtyItemCompact,
  SyncExportResult,
  SyncImportResult,
  SyncRemoteChanges,
  SyncSettingsUpdateResult,
  SyncStashResult,
  type SyncTask,
  SyncTaskCompact,
} from "@metabase/client/domain/git-sync";

import type { ResourceView } from "../view";

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

export const syncRemoteChangesView: ResourceView<SyncRemoteChanges> = {
  compactPick: SyncRemoteChanges,
  tableColumns: [
    { key: "has_changes", label: "Has changes" },
    { key: "remote_version", label: "Remote" },
    { key: "local_version", label: "Local" },
    { key: "cached", label: "Cached" },
  ],
};

export const syncBranchCreatedView: ResourceView<SyncBranchCreated> = {
  compactPick: SyncBranchCreated,
  tableColumns: [
    { key: "status", label: "Status" },
    { key: "message", label: "Message" },
  ],
};

export const syncSettingsUpdateView: ResourceView<SyncSettingsUpdateResult> = {
  compactPick: SyncSettingsUpdateResult,
  tableColumns: [
    { key: "success", label: "Success" },
    { key: "task_id", label: "Task ID" },
  ],
};

export const syncImportView: ResourceView<SyncImportResult> = {
  compactPick: SyncImportResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "message", label: "Message" },
  ],
};

export const syncExportView: ResourceView<SyncExportResult> = {
  compactPick: SyncExportResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "message", label: "Message" },
  ],
};

export const syncStashView: ResourceView<SyncStashResult> = {
  compactPick: SyncStashResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "status", label: "Status" },
    { key: "message", label: "Message" },
  ],
};

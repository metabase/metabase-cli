import {
  SyncBranchCreated,
  type SyncDirtyItem,
  SyncDirtyItemCompact,
  type SyncExportPreflight,
  SyncExportPreflightCompact,
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
    { key: "branch", label: "Branch" },
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

export const syncExportPreflightView: ResourceView<SyncExportPreflight> = {
  compactPick: SyncExportPreflightCompact,
  tableColumns: [],
};

function preflightHeadline(branch: string, result: SyncExportPreflight): string {
  if (result.reason === "history-rewritten") {
    return `Branch ${branch}: the remote history was rewritten, so no merge base exists; only a force push can export.`;
  }
  if (!result.has_changes) {
    return `Branch ${branch}: the remote has not moved past the last sync (on some servers a task that ended in conflict counts as one), or nothing has been synced yet; an export applies as-is.`;
  }
  if (result.clean) {
    return `Branch ${branch}: the remote has moved on; a merge applies cleanly.`;
  }
  return `Branch ${branch}: the remote has moved on; a merge would conflict.`;
}

function labelledBlock(title: string, labels: readonly string[]): string[] {
  if (labels.length === 0) {
    return [];
  }
  return [`${title} (${labels.length}):`, ...labels.map((label) => `  ${label}`)];
}

function mergeSummaryLine(result: SyncExportPreflight): string[] {
  if (!result.has_changes || result.reason !== null) {
    return [];
  }
  const { added, updated, removed } = result.summary;
  return [`A merge would fold in ${added} added, ${updated} updated, ${removed} removed.`];
}

export function formatExportPreflight(branch: string, result: SyncExportPreflight): string {
  const casualties = result.force_push_casualties;
  return [
    preflightHeadline(branch, result),
    ...labelledBlock("Conflicts", result.conflicts),
    ...mergeSummaryLine(result),
    ...labelledBlock("A force push would delete", casualties.deleted),
    ...labelledBlock("A force push would overwrite", casualties.overwritten),
  ].join("\n");
}

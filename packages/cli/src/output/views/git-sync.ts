import {
  type SyncDirtyItem,
  SyncDirtyItemCompact,
  SyncImportResult,
  SyncRemoteChanges,
  type SyncTask,
  SyncTaskCompact,
  SyncTree,
  type SyncTreeCollection,
} from "@metabase/client/domain/git-sync";

import type { ResourceView } from "../view";

const TREE_INDENT = "  ";

export const syncTreeView: ResourceView<SyncTree> = {
  compactPick: SyncTree,
  tableColumns: [{ key: "collections", label: "Collections" }],
};

/** The synced collections as an indented outline, each followed by the items directly inside it. */
export function formatSyncTree(tree: SyncTree): string {
  if (tree.collections.length === 0) {
    return "No collections are marked for sync.";
  }
  const childrenOf = (parentId: number | null): SyncTreeCollection[] =>
    tree.collections.filter((collection) => collection.parent_id === parentId);
  const lines: string[] = [];
  const visit = (collection: SyncTreeCollection, depth: number): void => {
    const indent = TREE_INDENT.repeat(depth);
    lines.push(`${indent}${collection.name} (${collection.id})`);
    for (const item of collection.items) {
      lines.push(`${indent}${TREE_INDENT}${item.model}: ${item.name} (${item.id})`);
    }
    for (const child of childrenOf(collection.id)) {
      visit(child, depth + 1);
    }
  };
  for (const root of childrenOf(null)) {
    visit(root, 0);
  }
  return lines.join("\n");
}

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

export const syncImportView: ResourceView<SyncImportResult> = {
  compactPick: SyncImportResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "message", label: "Message" },
  ],
};

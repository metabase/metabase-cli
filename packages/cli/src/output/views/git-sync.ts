import {
  type SyncDirtyItem,
  SyncDirtyItemCompact,
  SyncImportResult,
  SyncRemoteChanges,
  type SyncTask,
  SyncTaskCompact,
  SyncTree,
  type SyncTreeCollection,
  type SyncTreeItem,
  type SyncTreeTransforms,
} from "@metabase/client/domain/git-sync";

import type { ResourceView } from "../view";

const TREE_INDENT = "  ";

export const syncTreeView: ResourceView<SyncTree> = {
  compactPick: SyncTree,
  tableColumns: [{ key: "collections", label: "Collections" }],
};

const TRANSFORMS_HEADING = "Transforms";

function itemLine(item: SyncTreeItem, indent: string): string {
  return `${indent}${item.model}: ${item.name} (${item.id})`;
}

function outline(collections: readonly SyncTreeCollection[], depth: number): string[] {
  const childrenOf = (parentId: number | null): SyncTreeCollection[] =>
    collections.filter((collection) => collection.parent_id === parentId);
  const lines: string[] = [];
  const visit = (collection: SyncTreeCollection, level: number): void => {
    const indent = TREE_INDENT.repeat(level);
    lines.push(`${indent}${collection.name} (${collection.id})`);
    for (const item of collection.items) {
      lines.push(itemLine(item, `${indent}${TREE_INDENT}`));
    }
    for (const child of childrenOf(collection.id)) {
      visit(child, level + 1);
    }
  };
  for (const root of childrenOf(null)) {
    visit(root, depth);
  }
  return lines;
}

function transformsOutline(transforms: SyncTreeTransforms): string[] {
  return [
    TRANSFORMS_HEADING,
    ...outline(transforms.collections, 1),
    ...transforms.items.map((item) => itemLine(item, TREE_INDENT)),
  ];
}

/**
 * The synced collections as an indented outline, each followed by the items directly inside it,
 * then the transforms when the instance syncs them.
 */
export function formatSyncTree(tree: SyncTree): string {
  if (tree.collections.length === 0 && tree.transforms === null) {
    return "No collections are marked for sync.";
  }
  const transforms = tree.transforms === null ? [] : transformsOutline(tree.transforms);
  return [...outline(tree.collections, 0), ...transforms].join("\n");
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

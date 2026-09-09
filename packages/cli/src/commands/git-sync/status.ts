import { z } from "zod";

import { Collection } from "@metabase/client/domain/collection";
import { SyncTask } from "@metabase/client/domain/git-sync";
import { Worktree } from "@metabase/client/domain/worktree";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { formatSyncTask } from "./sync-task";

const SyncedCollection = Collection.pick({ id: true, name: true }).strip();
type SyncedCollection = z.infer<typeof SyncedCollection>;

const SyncStatusWorktree = Worktree.pick({ id: true, branch: true }).strip();

export const SyncStatus = z.object({
  branch: z.string().nullable(),
  worktree: SyncStatusWorktree.nullable(),
  is_dirty: z.boolean(),
  current_task: SyncTask.nullable(),
  synced_collections: z.array(SyncedCollection),
});
type SyncStatus = z.infer<typeof SyncStatus>;

const syncStatusView: ResourceView<SyncStatus> = {
  compactPick: SyncStatus,
  tableColumns: [
    { key: "branch", label: "Branch" },
    { key: "worktree", label: "Worktree" },
    { key: "is_dirty", label: "Dirty" },
    { key: "current_task", label: "Current task" },
    { key: "synced_collections", label: "Synced collections" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "status",
    description: "Show current git-sync state (branch, dirty, current task)",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details:
    "Inside a worktree the branch reported is the worktree's own and the dirty flag and current " +
    "task are the worktree's; the per-collection sync scope is the main app's alone, so it reads " +
    "empty there. " +
    WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: SyncStatus,
  examples: [
    "mb git-sync status",
    "mb git-sync status --json",
    "mb git-sync status --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    const mb = await getClient();
    const scope = await getWorktree();
    const query = scopeQuery(scope);
    const [isDirty, currentTask] = await Promise.all([
      mb.gitSync.isDirty(query),
      mb.gitSync.currentTask(query),
    ]);
    const taskPart = currentTask === null ? "No task running." : formatSyncTask(currentTask);
    const dirtyPart = isDirty ? "Metabase has unsynced local changes" : "in sync with the remote";

    if (scope !== null) {
      const status: SyncStatus = {
        branch: scope.branch,
        worktree: scope,
        is_dirty: isDirty,
        current_task: currentTask,
        synced_collections: [],
      };
      const scopePart = `Worktree ${scope.id} (${scope.branch})`;
      renderSummary(status, syncStatusView, `${scopePart} — ${dirtyPart}. ${taskPart}`, ctx);
      return;
    }

    const [branch, collections] = await Promise.all([
      mb.gitSync.branch(),
      mb.gitSync.syncedCollections(),
    ]);
    const syncedCollections: SyncedCollection[] = collections.data.map((collection) => ({
      id: collection.id,
      name: collection.name,
    }));

    const summary: SyncStatus = {
      branch,
      worktree: null,
      is_dirty: isDirty,
      current_task: currentTask,
      synced_collections: syncedCollections,
    };
    const branchPart = branch === null ? "git-sync branch not set" : `Branch ${branch}`;
    const scopePart = formatSyncedCollections(syncedCollections);
    renderSummary(
      summary,
      syncStatusView,
      `${branchPart} — ${dirtyPart}. ${taskPart} ${scopePart}`,
      ctx,
    );
  },
});

function formatSyncedCollections(collections: SyncedCollection[]): string {
  if (collections.length === 0) {
    return "No collections are marked for sync.";
  }
  const names = collections.map((collection) => `${collection.name} (${collection.id})`);
  return `Synced collections: ${names.join(", ")}.`;
}

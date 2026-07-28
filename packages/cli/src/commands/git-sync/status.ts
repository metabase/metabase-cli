import { z } from "zod";

import { Collection } from "@metabase/client/domain/collection";
import { SyncTask } from "@metabase/client/domain/git-sync";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { formatSyncTask } from "./sync-task";

const SyncedCollection = Collection.pick({ id: true, name: true }).strip();
type SyncedCollection = z.infer<typeof SyncedCollection>;

export const SyncStatus = z.object({
  branch: z.string().nullable(),
  is_dirty: z.boolean(),
  current_task: SyncTask.nullable(),
  synced_collections: z.array(SyncedCollection),
});
type SyncStatus = z.infer<typeof SyncStatus>;

const syncStatusView: ResourceView<SyncStatus> = {
  compactPick: SyncStatus,
  tableColumns: [
    { key: "branch", label: "Branch" },
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
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncStatus,
  examples: ["mb git-sync status", "mb git-sync status --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const [branch, isDirty, currentTask, collections] = await Promise.all([
      mb.gitSync.branch(),
      mb.gitSync.isDirty(),
      mb.gitSync.currentTask(),
      mb.gitSync.syncedCollections(),
    ]);
    const syncedCollections: SyncedCollection[] = collections.data.map((collection) => ({
      id: collection.id,
      name: collection.name,
    }));

    const summary: SyncStatus = {
      branch,
      is_dirty: isDirty,
      current_task: currentTask,
      synced_collections: syncedCollections,
    };
    const branchPart = branch === null ? "git-sync branch not set" : `Branch ${branch}`;
    const dirtyPart = isDirty ? "Metabase has unsynced local changes" : "in sync with the remote";
    const taskPart = currentTask === null ? "No task running." : formatSyncTask(currentTask);
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

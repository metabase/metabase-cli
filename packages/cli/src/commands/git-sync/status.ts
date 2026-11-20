import { z } from "zod";

import { Collection } from "@metabase/client/domain/collection";
import { RemoteSyncState, SyncTask, SyncType } from "@metabase/client/domain/git-sync";

import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { formatSyncTask } from "./sync-task";

const SyncedCollection = Collection.pick({ id: true, name: true }).strip();
type SyncedCollection = z.infer<typeof SyncedCollection>;

export const SyncStatus = z.object({
  remote_configured: z.boolean(),
  sync_type: RemoteSyncState.shape.sync_type,
  branch: RemoteSyncState.shape.branch,
  is_dirty: z.boolean(),
  current_task: SyncTask.nullable(),
  synced_collections: z.array(SyncedCollection),
});
type SyncStatus = z.infer<typeof SyncStatus>;

const syncStatusView: ResourceView<SyncStatus> = {
  compactPick: SyncStatus,
  tableColumns: [
    { key: "remote_configured", label: "Remote configured" },
    { key: "sync_type", label: "Sync type" },
    { key: "branch", label: "Branch" },
    { key: "is_dirty", label: "Dirty" },
    { key: "current_task", label: "Current task" },
    { key: "synced_collections", label: "Synced collections" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "status",
    description: "Show current git-sync state (remote, sync type, branch, dirty, current task)",
  },
  details:
    "Shows whether a remote is set up, the sync type (`read-only` or `read-write`), the tracked branch, the dirty flag, the most recent task (`null` when none has run) and the collections marked for sync. Refused (exit 2) on a server without the `remote_sync` token feature, where the sync scope would read as empty.",
  requires: [
    "gitSync.remote",
    "gitSync.isDirty",
    "gitSync.currentTask",
    "gitSync.syncedCollections",
  ],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncStatus,
  examples: ["mb git-sync status", "mb git-sync status --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    // The remote read starts its probe first, so the check the synced collections make before
    // their request joins that probe rather than starting another, and the run reads the session
    // properties once. The remote read also refuses a non-admin by itself, so every read settles
    // and the first failure in this order is reported: that caller's failure is the admin-only
    // endpoints' 403, not the remote read's refusal, whichever lands first.
    const remoteRead = mb.gitSync.remote();
    const [dirtyRead, taskRead, collectionsRead, settledRemote] = await Promise.allSettled([
      mb.gitSync.isDirty(),
      mb.gitSync.currentTask(),
      mb.gitSync.syncedCollections(),
      remoteRead,
    ]);
    const isDirty = fulfilled(dirtyRead);
    const currentTask = fulfilled(taskRead);
    const collections = fulfilled(collectionsRead);
    const remote = fulfilled(settledRemote);
    const syncedCollections: SyncedCollection[] = collections.data.map((collection) => ({
      id: collection.id,
      name: collection.name,
    }));

    const summary: SyncStatus = {
      remote_configured: remote.configured,
      sync_type: remote.sync_type,
      branch: remote.branch,
      is_dirty: isDirty,
      current_task: currentTask,
      synced_collections: syncedCollections,
    };
    const remotePart = formatRemote(remote);
    const branchPart =
      remote.branch === null ? "git-sync branch not set" : `Branch ${remote.branch}`;
    const dirtyPart = formatDirty(summary);
    const taskPart = currentTask === null ? "No task running." : formatSyncTask(currentTask);
    const scopePart = formatSyncedCollections(syncedCollections);
    renderSummary(
      summary,
      syncStatusView,
      `${remotePart} ${branchPart} — ${dirtyPart}. ${taskPart} ${scopePart}`,
      ctx,
    );
  },
});

function formatRemote(remote: RemoteSyncState): string {
  const known = SyncType.safeParse(remote.sync_type).success;
  const syncType = known ? remote.sync_type : `unrecognized sync type "${remote.sync_type}"`;
  return remote.configured
    ? `Remote configured, ${syncType}.`
    : `No remote configured (${syncType}).`;
}

function formatDirty(status: SyncStatus): string {
  if (status.is_dirty) {
    return "Metabase has unsynced local changes";
  }
  return status.remote_configured ? "in sync with the remote" : "no unsynced local changes";
}

function formatSyncedCollections(collections: SyncedCollection[]): string {
  if (collections.length === 0) {
    return "No collections are marked for sync.";
  }
  const names = collections.map((collection) => `${collection.name} (${collection.id})`);
  return `Synced collections: ${names.join(", ")}.`;
}

function fulfilled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") {
    throw result.reason;
  }
  return result.value;
}

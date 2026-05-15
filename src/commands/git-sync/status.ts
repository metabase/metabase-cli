import { z } from "zod";

import { SyncTask } from "../../domain/git-sync";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { IsDirtyResult } from "./is-dirty";
import { fetchCurrentTask, fetchOptionalParsed, REMOTE_SYNC_PATHS } from "./poll-task";

const RemoteSyncBranch = z.string().nullable();

export const SyncStatus = z.object({
  branch: z.string().nullable(),
  is_dirty: z.boolean(),
  current_task: SyncTask.nullable(),
});
type SyncStatus = z.infer<typeof SyncStatus>;

const syncStatusView: ResourceView<SyncStatus> = {
  compactPick: SyncStatus,
  tableColumns: [
    { key: "branch", label: "Branch" },
    { key: "is_dirty", label: "Dirty" },
    { key: "current_task", label: "Current task" },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "status",
    description: "Show current git-sync state (branch, dirty, current task)",
  },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncStatus,
  examples: ["mb git-sync status", "mb git-sync status --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const [branch, isDirty, currentTask] = await Promise.all([
      fetchOptionalParsed(client, "/api/setting/remote-sync-branch", RemoteSyncBranch),
      client.requestParsed(IsDirtyResult, REMOTE_SYNC_PATHS.isDirty),
      fetchCurrentTask(client),
    ]);

    const summary: SyncStatus = {
      branch,
      is_dirty: isDirty.is_dirty,
      current_task: currentTask,
    };
    renderItem(summary, syncStatusView, ctx);
  },
});

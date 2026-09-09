import { syncTaskView } from "../../output/views/git-sync";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { formatSyncTask, syncTaskIdleView, SyncTaskIdle, SyncTaskOrIdle } from "./sync-task";

export const CurrentTaskResult = SyncTaskOrIdle;

export default defineMetabaseCommand({
  meta: {
    name: "current-task",
    description: "Get the most recent git-sync task (or idle if none)",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: CurrentTaskResult,
  examples: ["mb git-sync current-task", "mb git-sync current-task --json"],
  async run({ ctx, getClient, getWorktree }) {
    const mb = await getClient();
    const scope = await getWorktree();
    const task = await mb.gitSync.currentTask(scopeQuery(scope));
    if (task === null) {
      const idle: SyncTaskIdle = { status: "idle" };
      renderSummary(idle, syncTaskIdleView, "No git-sync task is running.", ctx);
      return;
    }
    renderSummary(task, syncTaskView, formatSyncTask(task), ctx);
  },
});

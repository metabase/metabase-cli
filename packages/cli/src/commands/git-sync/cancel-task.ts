import { SyncTask } from "@metabase/client/domain/git-sync";
import type { SyncCancelTaskParams } from "@metabase/client/resources/git-sync";

import { syncTaskView } from "../../output/views/git-sync";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "cancel-task", description: "Cancel the running git-sync task" },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: SyncTask,
  examples: ["mb git-sync cancel-task", "mb git-sync cancel-task --json"],
  async run({ ctx, getClient, getWorktree }) {
    const mb = await getClient();
    const scope = await getWorktree();
    const params: SyncCancelTaskParams = scope === null ? {} : { worktree_id: scope.id };
    const task = await mb.gitSync.cancelTask(params);
    renderSummary(
      task,
      syncTaskView,
      `Requested cancellation of ${task.sync_task_type} task #${task.id}.`,
      ctx,
    );
  },
});

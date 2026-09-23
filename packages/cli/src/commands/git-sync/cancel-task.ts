import { SyncTask } from "@metabase/client/domain/git-sync";

import { syncTaskView } from "../../output/views/git-sync";
import { renderSummary } from "../../output/render";
import { outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "cancel-task", description: "Cancel the running git-sync task" },
  requires: ["gitSync.cancelTask"],
  args: { ...outputFlags, ...preflightFlag },
  outputSchema: SyncTask,
  examples: ["mb git-sync cancel-task", "mb git-sync cancel-task --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const task = await mb.gitSync.cancelTask();
    renderSummary(
      task,
      syncTaskView,
      `Requested cancellation of ${task.sync_task_type} task #${task.id}.`,
      ctx,
    );
  },
});

import { SyncTask } from "@metabase/client/domain/git-sync";

import { syncTaskView } from "../../output/views/git-sync";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "cancel-task", description: "Cancel the running git-sync task" },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
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

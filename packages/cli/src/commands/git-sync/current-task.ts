import { syncTaskView } from "../../output/views/git-sync";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { formatSyncTask, syncTaskIdleView, SyncTaskIdle, SyncTaskOrIdle } from "./sync-task";

export const CurrentTaskResult = SyncTaskOrIdle;

export default defineMetabaseCommand({
  meta: {
    name: "current-task",
    description: "Get the most recent git-sync task (or idle if none)",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: CurrentTaskResult,
  examples: ["mb git-sync current-task", "mb git-sync current-task --json"],
  async run({ ctx, getClient }) {
    const mb = await getClient();
    const task = await mb.gitSync.currentTask();
    if (task === null) {
      const idle: SyncTaskIdle = { status: "idle" };
      renderSummary(idle, syncTaskIdleView, "No git-sync task is running.", ctx);
      return;
    }
    renderSummary(task, syncTaskView, formatSyncTask(task), ctx);
  },
});

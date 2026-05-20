import { syncTaskView } from "../../domain/git-sync";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { fetchCurrentTask, syncTaskIdleView, SyncTaskIdle, SyncTaskOrIdle } from "./poll-task";

export const CurrentTaskResult = SyncTaskOrIdle;

export default defineMetabaseCommand({
  meta: {
    name: "current-task",
    description: "Get the most recent git-sync task (or idle if none)",
  },
  capabilities: { minVersion: 58, edition: "ee", tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: CurrentTaskResult,
  examples: ["mb git-sync current-task", "mb git-sync current-task --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const task = await fetchCurrentTask(client);
    if (task === null) {
      const idle: SyncTaskIdle = { status: "idle" };
      renderItem(idle, syncTaskIdleView, ctx);
      return;
    }
    renderItem(task, syncTaskView, ctx);
  },
});

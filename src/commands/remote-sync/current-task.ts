import { syncTaskView } from "../../domain/remote-sync";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { fetchCurrentTask, syncTaskIdleView, SyncTaskIdle, SyncTaskOrIdle } from "./poll-task";

export const CurrentTaskResult = SyncTaskOrIdle;

export default defineMetabaseCommand({
  meta: {
    name: "current-task",
    description: "Get the most recent remote-sync task (or idle if none)",
  },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: CurrentTaskResult,
  examples: ["metabase remote-sync current-task", "metabase remote-sync current-task --json"],
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

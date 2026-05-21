import { SyncTask, syncTaskView } from "../../domain/git-sync";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

export default defineMetabaseCommand({
  meta: { name: "cancel-task", description: "Cancel the running git-sync task" },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: SyncTask,
  examples: ["mb git-sync cancel-task", "mb git-sync cancel-task --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const task = await client.requestParsed(SyncTask, REMOTE_SYNC_PATHS.cancelTask, {
      method: "POST",
    });
    renderItem(task, syncTaskView, ctx);
  },
});

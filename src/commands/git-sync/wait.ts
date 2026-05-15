import { syncTaskView } from "../../domain/git-sync";
import { renderItem } from "../../output/render";
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "../../runtime/poll";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import {
  pollSyncTask,
  syncTaskIdleView,
  SyncTaskIdle,
  SyncTaskOrIdle,
  throwIfFailedTask,
} from "./poll-task";

export const WaitResult = SyncTaskOrIdle;

export default defineMetabaseCommand({
  meta: {
    name: "wait",
    description: "Poll the current git-sync task until it reaches a terminal status",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    timeout: {
      type: "string",
      description: "Polling timeout in ms",
      default: String(DEFAULT_TIMEOUT_MS),
    },
    interval: {
      type: "string",
      description: "Polling interval in ms",
      default: String(DEFAULT_INTERVAL_MS),
    },
  },
  outputSchema: WaitResult,
  examples: ["mb git-sync wait", "mb git-sync wait --timeout 300000 --json"],
  async run({ args, ctx, getClient }) {
    const timeoutMs = parseId(args.timeout, "timeout");
    const intervalMs = parseId(args.interval, "interval");
    const client = await getClient();
    const final = await pollSyncTask(client, { timeoutMs, intervalMs });

    if (final === null) {
      const idle: SyncTaskIdle = { status: "idle" };
      renderItem(idle, syncTaskIdleView, ctx);
      return;
    }

    renderItem(final, syncTaskView, ctx);
    throwIfFailedTask(final, "task");
  },
});

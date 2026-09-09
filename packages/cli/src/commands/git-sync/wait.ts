import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "@metabase/client/poll";

import { renderSummary } from "../../output/render";
import { syncTaskView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseWaitSchedule } from "../wait-flags";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import {
  formatSyncTask,
  syncTaskIdleView,
  SyncTaskIdle,
  SyncTaskOrIdle,
  taskPollOptions,
  throwIfFailedTask,
} from "./sync-task";

export const WaitResult = SyncTaskOrIdle;

export default defineMetabaseCommand({
  meta: {
    name: "wait",
    description: "Poll the current git-sync task until it reaches a terminal status",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
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
  async run({ args, ctx, getClient, getWorktree }) {
    const schedule = parseWaitSchedule(args);
    const mb = await getClient();
    const scope = await getWorktree();
    const final = await mb.gitSync.waitForTask(taskPollOptions(schedule), scopeQuery(scope));

    if (final === null) {
      const idle: SyncTaskIdle = { status: "idle" };
      renderSummary(idle, syncTaskIdleView, "No git-sync task is running.", ctx);
      return;
    }

    renderSummary(final, syncTaskView, formatSyncTask(final), ctx);
    throwIfFailedTask(final, "task");
  },
});

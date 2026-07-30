import { SyncStashResult } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";
import type { SyncStashParams } from "@metabase/client/resources/git-sync";

import { renderSummary } from "../../output/render";
import { syncStashView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

const DEFAULT_STASH_MESSAGE = "Stashed from mb CLI";

export default defineMetabaseCommand({
  meta: {
    name: "stash",
    description: "Export current Metabase state to a new branch on the git remote",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    newBranch: {
      type: "string",
      description: "Branch to create and export to",
      alias: "new-branch",
      required: true,
    },
    message: {
      type: "string",
      description: "Commit message",
      alias: "m",
      default: DEFAULT_STASH_MESSAGE,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncStashResult,
  examples: [
    "mb git-sync stash --new-branch wip",
    'mb git-sync stash --new-branch wip -m "work in progress" --json',
  ],
  async run({ args, ctx, getClient }) {
    const newBranch = args.newBranch.trim();
    if (newBranch === "") {
      throw new ConfigError("invalid new-branch: must not be blank");
    }
    const message = args.message.trim();
    if (message === "") {
      throw new ConfigError("invalid message: must not be blank");
    }
    const wait = parseWaitFlags(args);

    const params: SyncStashParams = { new_branch: newBranch, message };
    if (wait.enabled) {
      params.wait = taskPollOptions(wait.schedule);
    }

    const mb = await getClient();
    const result = await mb.gitSync.stash(params);

    if (!wait.enabled) {
      renderSummary(
        result,
        syncStashView,
        `Started stash to branch "${newBranch}" (task #${result.task_id}).`,
        ctx,
      );
      return;
    }

    const final = result.final ?? null;
    const succeeded = final === null || final.status === "successful";
    const text = succeeded
      ? `Stashed Metabase state to branch "${newBranch}" (task #${result.task_id}).`
      : formatSyncTask(final);
    renderSummary(result, syncStashView, text, ctx);
    throwIfFailedTask(final, "stash");
  },
});

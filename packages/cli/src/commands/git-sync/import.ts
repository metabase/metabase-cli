import { SyncImportResult } from "@metabase/client/domain/git-sync";
import type { SyncImportParams } from "@metabase/client/resources/git-sync";

import { renderSummary } from "../../output/render";
import { syncImportView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";
import { WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { resolveSyncBranch } from "./branch";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "import",
    description: "Import content from the configured git remote into Metabase",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details:
    "Inside a worktree the branch is the worktree's own, so --branch is refused there. " +
    WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    branch: {
      type: "string",
      description: "Branch to import from (defaults to remote-sync-branch setting)",
      alias: "b",
    },
    force: {
      type: "boolean",
      description: "Discard local Metabase-side dirty changes (LOSSY)",
      default: false,
    },
    merge: {
      type: "boolean",
      description: "Three-way merge remote changes instead of failing on divergence",
      default: false,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncImportResult,
  examples: [
    "mb git-sync import",
    "mb git-sync import --branch main --json",
    "mb git-sync import --force --no-wait",
    "mb git-sync import --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const wait = parseWaitFlags(args);
    const mb = await getClient();
    const scope = await getWorktree();
    const target = await resolveSyncBranch(mb, scope, args.branch);

    const params: SyncImportParams = { branch: target.branch, expected_branch: target.expected };
    if (scope !== null) {
      params.worktree_id = scope.id;
    }
    if (args.force) {
      params.force = true;
    }
    if (args.merge) {
      params.merge = true;
    }
    if (wait.enabled) {
      params.wait = taskPollOptions(wait.schedule);
    }

    const result = await mb.gitSync.import(params);

    if (!wait.enabled || result.task_id === null) {
      const text =
        result.task_id === null
          ? (result.message ?? "Already up to date; nothing to import.")
          : `Started import task #${result.task_id}.`;
      renderSummary(result, syncImportView, text, ctx);
      return;
    }

    const final = result.final ?? null;
    const text =
      final === null ? `Import task #${result.task_id} finished.` : formatSyncTask(final);
    renderSummary(result, syncImportView, text, ctx);
    throwIfFailedTask(final, "import");
  },
});

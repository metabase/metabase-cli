import { SyncExportResult } from "@metabase/client/domain/git-sync";
import type { SyncExportParams } from "@metabase/client/resources/git-sync";

import { warn } from "../../output/notice";
import { renderSummary } from "../../output/render";
import { syncExportView } from "../../output/views/git-sync";
import type { CommonContext } from "../context";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";
import { WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { resolveSyncBranch } from "./branch";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "export",
    description: "Export Metabase changes back to the configured git remote",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  worktree: "scoped",
  details:
    "Inside a worktree the branch is the worktree's own, so --branch is refused there. " +
    "Preview what a push would do with `mb git-sync export-preflight` first. " +
    WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    branch: {
      type: "string",
      description: "Branch to export to (defaults to remote-sync-branch setting)",
      alias: "b",
    },
    message: {
      type: "string",
      description: "Commit message",
      alias: "m",
    },
    force: {
      type: "boolean",
      description: "Force-push / overwrite remote",
      default: false,
    },
    merge: {
      type: "boolean",
      description: "Three-way merge remote changes instead of failing on divergence",
      default: false,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncExportResult,
  examples: [
    'mb git-sync export -m "update dashboards"',
    "mb git-sync export --branch main --json",
    "mb git-sync export --no-wait",
    'mb git-sync export --worktree feat/transforms -m "new transforms"',
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const wait = parseWaitFlags(args);
    const mb = await getClient();
    const scope = await getWorktree();
    const target = await resolveSyncBranch(mb, scope, args.branch);

    const params: SyncExportParams = { branch: target.branch };
    if (scope !== null) {
      params.worktree_id = scope.id;
    }
    if (args.message !== undefined && args.message !== "") {
      params.message = args.message;
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

    const result = await mb.gitSync.export(params);

    if (!wait.enabled) {
      renderSummary(result, syncExportView, `Started export task #${result.task_id}.`, ctx);
    } else {
      const final = result.final ?? null;
      const text =
        final === null ? `Export task #${result.task_id} finished.` : formatSyncTask(final);
      renderSummary(result, syncExportView, text, ctx);
      throwIfFailedTask(final, "export");
    }
    if (scope === null) {
      emitRealignHint(ctx);
    }
  },
});

// A worktree is not the instance's own checkout, so nothing on the host tree moved with it.
function emitRealignHint(ctx: CommonContext): void {
  if (ctx.format !== "text") {
    return;
  }
  warn(
    "\nNote: if exporting to a host-bound repo, realign the host working tree with:\n" +
      "  git -C <repo-path> restore --staged --worktree .",
  );
}

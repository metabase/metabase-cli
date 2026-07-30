import { SyncExportResult } from "@metabase/client/domain/git-sync";
import type { SyncExportParams } from "@metabase/client/resources/git-sync";

import { warn } from "../../output/notice";
import { renderSummary } from "../../output/render";
import { syncExportView } from "../../output/views/git-sync";
import type { CommonContext } from "../context";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "export",
    description: "Export Metabase changes back to the configured git remote",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
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
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncExportResult,
  examples: [
    'mb git-sync export -m "update dashboards"',
    "mb git-sync export --branch main --json",
    "mb git-sync export --no-wait",
  ],
  async run({ args, ctx, getClient }) {
    const wait = parseWaitFlags(args);
    const params: SyncExportParams = {};
    if (args.branch !== undefined && args.branch !== "") {
      params.branch = args.branch;
    }
    if (args.message !== undefined && args.message !== "") {
      params.message = args.message;
    }
    if (args.force) {
      params.force = true;
    }
    if (wait.enabled) {
      params.wait = taskPollOptions(wait.schedule);
    }

    const mb = await getClient();
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
    emitRealignHint(ctx);
  },
});

function emitRealignHint(ctx: CommonContext): void {
  if (ctx.format !== "text") {
    return;
  }
  warn(
    "\nNote: if exporting to a host-bound repo, realign the host working tree with:\n" +
      "  git -C <repo-path> restore --staged --worktree .",
  );
}

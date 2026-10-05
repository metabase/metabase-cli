import { SyncExportResult } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";
import type { SyncExportParams } from "@metabase/client/resources/git-sync";

import { warn } from "../../output/notice";
import { renderSummary } from "../../output/render";
import { syncExportView } from "../../output/views/git-sync";
import type { CommonContext } from "../context";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { branchFlag } from "./branch-flag";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "export",
    description: "Export Metabase changes back to the configured git remote",
  },
  details:
    "The export targets the branch git-sync tracks. On Metabase 63+ `--branch` defaults to it and must name it (the server answers 409 for any other branch); older servers export to the branch `--branch` names and switch git-sync to it, refusing with 400 when that branch's tip is not the last synced commit unless --force is given. To push to a new branch, use `git-sync stash` or `git-sync create-branch` first. When the remote has moved past the last sync, a plain export ends in a `conflict` task on 63+ and is refused with 400 on older servers. --merge (63+) folds the remote's changes in by a three-way merge (entities changed on both sides still end in `conflict`), --force overwrites them. `git-sync export-preflight` previews which applies. A task that ends in `conflict` may make the server count the remote commit it saw as synced, so a retry, --merge included, may no longer see the remote's changes: resolve a conflict with --force on the side to keep, or `git-sync create-branch`, export, then `import --force`, merge the new branch in git, and switch back with `import --branch <original>`, never with a retry.",
  requires: ["gitSync.export"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: {
      type: "string",
      description:
        "Branch to export to (defaults to the remote-sync-branch setting; on 63+ it must be that branch)",
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
      description:
        "When the remote moved on, fold its changes in by a three-way merge instead of ending in conflict",
      default: false,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncExportResult,
  examples: [
    'mb git-sync export -m "update dashboards"',
    'mb git-sync export --merge -m "update dashboards"',
    "mb git-sync export --branch main --json",
    "mb git-sync export --no-wait",
  ],
  async run({ args, ctx, getClient }) {
    const wait = parseWaitFlags(args);
    if (args.merge && args.force) {
      throw new ConfigError("--merge cannot be combined with --force");
    }
    const branch = branchFlag(args.branch);
    const params: SyncExportParams = {};
    if (branch !== null) {
      params.branch = branch;
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

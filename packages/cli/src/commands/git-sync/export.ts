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
import { mergeRefusal } from "./merge-refusal";

import { branchFlag } from "./branch-flag";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "export",
    description: "Export Metabase changes back to the configured git remote",
  },
  details: `The export targets the branch git-sync tracks. On Metabase 63+ \`--branch\` defaults to it and must name it (the server responds with a 409 for any other branch); older servers export to the branch \`--branch\` names and switch git-sync to it, refusing with a 400 when that branch's tip isn't the last synced commit unless \`--force\` is given. To push to a new branch, use \`git-sync stash\` or \`git-sync create-branch\` first: a \`--branch\` other than the tracked one is looked up on the remote, and one missing there is refused before the export (exit 2) with a pointer to \`create-branch\`. The result's \`branch\` names the target, and the text output ends with it; it's \`null\` only when no \`--branch\` was given and a server older than 63 exported to the branch it tracks. When the remote has moved past the last sync, a plain export ends in a \`conflict\` task on 63+ and is refused with a 400 on older servers; \`--merge\` folds the remote's changes in by a three-way merge, \`--force\` overwrites them, and \`git-sync export-preflight\` previews which applies. ${mergeRefusal("export")}`,
  requires: ["gitSync.branch", "gitSync.branches", "gitSync.export"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: {
      type: "string",
      description:
        "Branch to export to (defaults to the remote-sync-branch setting; on 63+ it must be that branch); a blank name is refused",
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
        "When the remote moved on, fold its changes in by a three-way merge instead of ending in `conflict`; entities changed on both sides still end in `conflict`, writing nothing. Can't be used with `--force`",
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
    // A guarded server answers an export to a branch missing from the remote with a 409 about the
    // tracked branch having moved, which points away from the fix.
    if (branch !== null && (await mb.gitSync.branch()) !== branch) {
      const remote = await mb.gitSync.branches();
      if (!remote.data.includes(branch)) {
        throw missingBranchError(branch);
      }
    }
    const result = await mb.gitSync.export(params);

    const target = result.branch === null ? "" : ` Branch: ${result.branch}.`;
    if (!wait.enabled) {
      renderSummary(
        result,
        syncExportView,
        `Started export task #${result.task_id}.${target}`,
        ctx,
      );
    } else {
      const final = result.final ?? null;
      const text =
        final === null ? `Export task #${result.task_id} finished.` : formatSyncTask(final);
      renderSummary(result, syncExportView, `${text}${target}`, ctx);
      throwIfFailedTask(final, "export");
    }
    emitRealignHint(ctx);
  },
});

function missingBranchError(branch: string): ConfigError {
  return new ConfigError(
    `branch "${branch}" does not exist on the remote; run \`mb git-sync create-branch ${branch}\` to create it and switch git-sync to it, then export without --branch`,
  );
}

function emitRealignHint(ctx: CommonContext): void {
  if (ctx.format !== "text") {
    return;
  }
  warn(
    "\nNote: if exporting to a host-bound repo, realign the host working tree with:\n" +
      "  git -C <repo-path> restore --staged --worktree .",
  );
}

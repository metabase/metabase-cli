import { SyncImportResult } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";
import type { SyncImportParams } from "@metabase/client/resources/git-sync";

import { renderSummary } from "../../output/render";
import { syncImportView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { branchFlag } from "./branch-flag";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "import",
    description: "Import content from the configured git remote into Metabase",
  },
  details:
    "A plain import refuses while Metabase holds un-pushed changes; --force discards them, --merge (Metabase 63+) keeps them and folds the remote's changes in by a three-way merge. A merge ends the task in `conflict`, leaving local content untouched, when entities changed on both sides or when there is no merge base: the remote history was rewritten, or the instance has never synced. A task that ends in `conflict` may make the server count the remote commit it saw as synced, so a retry, --merge included, may no longer see the remote's changes. Never answer a conflict with a retry: keep the remote's side with `import --force`, Metabase's with `export --force`, or both through a reviewed PR from a new branch (`mb skills get git-sync`, \"After a conflict task\").",
  requires: ["gitSync.import"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
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
      description: "Keep un-pushed local changes and fold the remote's in by a three-way merge",
      default: false,
    },
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncImportResult,
  examples: [
    "mb git-sync import",
    "mb git-sync import --branch main --json",
    "mb git-sync import --force --no-wait",
    "mb git-sync import --merge",
  ],
  async run({ args, ctx, getClient }) {
    const wait = parseWaitFlags(args);
    if (args.merge && args.force) {
      throw new ConfigError("--merge cannot be combined with --force");
    }
    const branch = branchFlag(args.branch);
    const params: SyncImportParams = {};
    if (branch !== null) {
      params.branch = branch;
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

import { SyncImportResult } from "@metabase/client/domain/git-sync";
import { ConfigError } from "@metabase/client/errors";
import type { SyncImportParams } from "@metabase/client/resources/git-sync";

import { renderSummary } from "../../output/render";
import { syncImportView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { branchFlag } from "./branch-flag";
import { mergeRefusal } from "./merge-refusal";
import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "import",
    description: "Import content from the configured git remote into Metabase",
  },
  details: `A plain import is refused while Metabase has changes it hasn't exported. A merge ends in \`conflict\`, with local content untouched, when entities changed on both sides or there's no merge base (the remote history was rewritten, or the instance never synced). ${mergeRefusal("import")}`,
  requires: ["gitSync.import"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    branch: {
      type: "string",
      description:
        "Branch to import from, which git-sync tracks once the import succeeds. Defaults to the tracked branch (the `remote-sync-branch` setting); can't be blank",
      alias: "b",
    },
    force: {
      type: "boolean",
      description: "Discard the changes Metabase hasn't exported. They're lost",
      default: false,
    },
    merge: {
      type: "boolean",
      description:
        "Keep the changes Metabase hasn't exported, and merge the remote's changes in. Can't be used with `--force`",
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

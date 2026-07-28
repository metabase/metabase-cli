import { SyncImportResult } from "@metabase/client/domain/git-sync";
import type { SyncImportParams } from "@metabase/client/resources/git-sync";

import { renderSummary } from "../../output/render";
import { syncImportView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { formatSyncTask, taskPollOptions, throwIfFailedTask } from "./sync-task";

export default defineMetabaseCommand({
  meta: {
    name: "import",
    description: "Import content from the configured git remote into Metabase",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
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
    ...gitSyncWaitFlags,
  },
  outputSchema: SyncImportResult,
  examples: [
    "mb git-sync import",
    "mb git-sync import --branch main --json",
    "mb git-sync import --force --no-wait",
  ],
  async run({ args, ctx, getClient }) {
    const wait = parseWaitFlags(args);
    const params: SyncImportParams = {};
    if (args.branch !== undefined && args.branch !== "") {
      params.branch = args.branch;
    }
    if (args.force) {
      params.force = true;
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

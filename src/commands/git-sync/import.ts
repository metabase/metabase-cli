import { z } from "zod";

import { SyncTask } from "../../domain/git-sync";
import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { formatSyncTask, pollSyncTask, REMOTE_SYNC_PATHS, throwIfFailedTask } from "./poll-task";

const SyncImportKickoff = z.object({
  status: z.literal("success"),
  task_id: z.number().int().positive().nullable(),
  message: z.string().nullable().optional(),
});

export const SyncImportResult = z.object({
  message: z.string().nullable(),
  task_id: z.number().int().positive().nullable(),
  final: SyncTask.nullable().optional(),
});
type SyncImportResult = z.infer<typeof SyncImportResult>;

const syncImportView: ResourceView<SyncImportResult> = {
  compactPick: SyncImportResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "message", label: "Message" },
  ],
};

interface ImportRequestBody {
  branch?: string;
  force?: boolean;
}

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
    const body: ImportRequestBody = {};
    if (args.branch !== undefined && args.branch !== "") {
      body.branch = args.branch;
    }
    if (args.force) {
      body.force = true;
    }

    const client = await getClient();
    const kickoff = await client.requestParsed(SyncImportKickoff, REMOTE_SYNC_PATHS.import, {
      method: "POST",
      body,
    });

    if (!wait.enabled || kickoff.task_id === null) {
      const result: SyncImportResult = {
        message: kickoff.message ?? null,
        task_id: kickoff.task_id,
      };
      const text =
        kickoff.task_id === null
          ? (kickoff.message ?? "Already up to date; nothing to import.")
          : `Started import task #${kickoff.task_id}.`;
      renderSummary(result, syncImportView, text, ctx);
      return;
    }

    const final = await pollSyncTask(client, wait.schedule);
    const result: SyncImportResult = {
      message: kickoff.message ?? null,
      task_id: kickoff.task_id,
      final,
    };
    const text =
      final === null ? `Import task #${kickoff.task_id} finished.` : formatSyncTask(final);
    renderSummary(result, syncImportView, text, ctx);
    throwIfFailedTask(final, "import");
  },
});

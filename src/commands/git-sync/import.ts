import { z } from "zod";

import { SyncTask } from "../../domain/git-sync";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { pollFlags, pollSyncTask, REMOTE_SYNC_PATHS, throwIfFailedTask } from "./poll-task";

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
    ...pollFlags,
  },
  outputSchema: SyncImportResult,
  examples: [
    "metabase git-sync import",
    "metabase git-sync import --branch main --json",
    "metabase git-sync import --force --no-wait",
  ],
  async run({ args, ctx, getClient }) {
    const timeoutMs = parseId(args.timeout, "timeout");
    const intervalMs = parseId(args.interval, "interval");
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

    if (!args.wait || kickoff.task_id === null) {
      const result: SyncImportResult = {
        message: kickoff.message ?? null,
        task_id: kickoff.task_id,
      };
      renderItem(result, syncImportView, ctx);
      return;
    }

    const final = await pollSyncTask(client, { timeoutMs, intervalMs });
    const result: SyncImportResult = {
      message: kickoff.message ?? null,
      task_id: kickoff.task_id,
      final,
    };
    renderItem(result, syncImportView, ctx);
    throwIfFailedTask(final, "import");
  },
});

import { z } from "zod";

import { SyncTask } from "../../domain/remote-sync";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import type { CommonContext } from "../context";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { pollFlags, pollSyncTask, REMOTE_SYNC_PATHS, throwIfFailedTask } from "./poll-task";

const SyncExportKickoff = z.object({
  message: z.string(),
  task_id: z.number().int().positive(),
});

export const SyncExportResult = z.object({
  message: z.string(),
  task_id: z.number().int().positive(),
  final: SyncTask.nullable().optional(),
});
type SyncExportResult = z.infer<typeof SyncExportResult>;

const syncExportView: ResourceView<SyncExportResult> = {
  compactPick: SyncExportResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "message", label: "Message" },
  ],
};

interface ExportRequestBody {
  branch?: string;
  message?: string;
  force?: boolean;
}

export default defineMetabaseCommand({
  meta: {
    name: "export",
    description: "Export Metabase changes back to the configured git remote",
  },
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
    ...pollFlags,
  },
  outputSchema: SyncExportResult,
  examples: [
    'metabase sync export -m "update dashboards"',
    "metabase sync export --branch main --json",
    "metabase sync export --no-wait",
  ],
  async run({ args, ctx, getClient }) {
    const timeoutMs = parseId(args.timeout, "timeout");
    const intervalMs = parseId(args.interval, "interval");
    const body: ExportRequestBody = {};
    if (args.branch !== undefined && args.branch !== "") {
      body.branch = args.branch;
    }
    if (args.message !== undefined && args.message !== "") {
      body.message = args.message;
    }
    if (args.force) {
      body.force = true;
    }

    const client = await getClient();
    const kickoff = await client.requestParsed(SyncExportKickoff, REMOTE_SYNC_PATHS.export, {
      method: "POST",
      body,
    });

    if (!args.wait) {
      const result: SyncExportResult = { message: kickoff.message, task_id: kickoff.task_id };
      renderItem(result, syncExportView, ctx);
      emitRealignHint(ctx);
      return;
    }

    const final = await pollSyncTask(client, { timeoutMs, intervalMs });
    const result: SyncExportResult = {
      message: kickoff.message,
      task_id: kickoff.task_id,
      final,
    };
    renderItem(result, syncExportView, ctx);
    throwIfFailedTask(final, "export");
    emitRealignHint(ctx);
  },
});

function emitRealignHint(ctx: CommonContext): void {
  if (ctx.format !== "text") return;
  process.stderr.write(
    "\nNote: if exporting to a host-bound repo, realign the host working tree with:\n" +
      "  git -C <repo-path> restore --staged --worktree .\n",
  );
}

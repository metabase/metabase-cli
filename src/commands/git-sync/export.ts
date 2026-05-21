import { z } from "zod";

import { SyncTask } from "../../domain/git-sync";
import type { ResourceView } from "../../domain/view";
import { warn } from "../../output/notice";
import { renderItem } from "../../output/render";
import type { CommonContext } from "../context";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { gitSyncWaitFlags, parseWaitFlags } from "../wait-flags";

import { pollSyncTask, REMOTE_SYNC_PATHS, throwIfFailedTask } from "./poll-task";

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

    if (!wait.enabled) {
      const result: SyncExportResult = { message: kickoff.message, task_id: kickoff.task_id };
      renderItem(result, syncExportView, ctx);
    } else {
      const final = await pollSyncTask(client, wait.schedule);
      const result: SyncExportResult = {
        message: kickoff.message,
        task_id: kickoff.task_id,
        final,
      };
      renderItem(result, syncExportView, ctx);
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

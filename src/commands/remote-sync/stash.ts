import { z } from "zod";

import { ConfigError } from "../../core/errors";
import { SyncTask } from "../../domain/remote-sync";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { pollFlags, pollSyncTask, REMOTE_SYNC_PATHS, throwIfFailedTask } from "./poll-task";

const SyncStashKickoff = z.object({
  status: z.literal("success"),
  message: z.string(),
  task_id: z.number().int().positive(),
});

export const SyncStashResult = z.object({
  status: z.literal("success"),
  message: z.string(),
  task_id: z.number().int().positive(),
  final: SyncTask.nullable().optional(),
});
type SyncStashResult = z.infer<typeof SyncStashResult>;

const syncStashView: ResourceView<SyncStashResult> = {
  compactPick: SyncStashResult,
  tableColumns: [
    { key: "task_id", label: "Task ID" },
    { key: "status", label: "Status" },
    { key: "message", label: "Message" },
  ],
};

interface StashRequestBody {
  new_branch: string;
  message: string;
}

const DEFAULT_STASH_MESSAGE = "Stashed from metabase CLI";

export default defineMetabaseCommand({
  meta: {
    name: "stash",
    description: "Export current Metabase state to a new branch on the git remote",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    newBranch: {
      type: "string",
      description: "Branch to create and export to",
      alias: "new-branch",
      required: true,
    },
    message: {
      type: "string",
      description: "Commit message",
      alias: "m",
      default: DEFAULT_STASH_MESSAGE,
    },
    ...pollFlags,
  },
  outputSchema: SyncStashResult,
  examples: [
    "metabase remote-sync stash --new-branch wip",
    'metabase remote-sync stash --new-branch wip -m "work in progress" --json',
  ],
  async run({ args, ctx, getClient }) {
    const newBranch = args.newBranch.trim();
    if (newBranch === "") {
      throw new ConfigError("invalid new-branch: must not be blank");
    }
    const message = args.message.trim();
    if (message === "") {
      throw new ConfigError("invalid message: must not be blank");
    }
    const timeoutMs = parseId(args.timeout, "timeout");
    const intervalMs = parseId(args.interval, "interval");

    const body: StashRequestBody = { new_branch: newBranch, message };
    const client = await getClient();
    const kickoff = await client.requestParsed(SyncStashKickoff, REMOTE_SYNC_PATHS.stash, {
      method: "POST",
      body,
    });

    if (!args.wait) {
      const result: SyncStashResult = {
        status: kickoff.status,
        message: kickoff.message,
        task_id: kickoff.task_id,
      };
      renderItem(result, syncStashView, ctx);
      return;
    }

    const final = await pollSyncTask(client, { timeoutMs, intervalMs });
    const result: SyncStashResult = {
      status: kickoff.status,
      message: kickoff.message,
      task_id: kickoff.task_id,
      final,
    };
    renderItem(result, syncStashView, ctx);
    throwIfFailedTask(final, "stash");
  },
});

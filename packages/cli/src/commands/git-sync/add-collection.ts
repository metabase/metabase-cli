import { z } from "zod";

import type { Client } from "../../core/http/client";
import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { REMOTE_SYNC_PATHS } from "./poll-task";

export const SyncSettingsUpdateResult = z.object({
  success: z.boolean(),
  task_id: z.number().int().positive().optional(),
});
export type SyncSettingsUpdateResult = z.infer<typeof SyncSettingsUpdateResult>;

export const syncSettingsUpdateView: ResourceView<SyncSettingsUpdateResult> = {
  compactPick: SyncSettingsUpdateResult,
  tableColumns: [
    { key: "success", label: "Success" },
    { key: "task_id", label: "Task ID" },
  ],
};

export async function setCollectionRemoteSynced(
  client: Client,
  collectionId: number,
  synced: boolean,
): Promise<SyncSettingsUpdateResult> {
  return await client.requestParsed(SyncSettingsUpdateResult, REMOTE_SYNC_PATHS.settings, {
    method: "PUT",
    body: { collections: { [collectionId]: synced } },
  });
}

export default defineMetabaseCommand({
  meta: {
    name: "add-collection",
    description: "Mark a collection as git-synced; cascades to descendants by location prefix",
  },
  capabilities: { minVersion: 60, tokenFeature: "remote_sync" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Collection id (positive integer)", required: true },
  },
  outputSchema: SyncSettingsUpdateResult,
  examples: [
    "mb git-sync add-collection 12",
    "mb git-sync add-collection 12 --json --profile prod",
  ],
  async run({ args, ctx, getClient }) {
    const collectionId = parseId(args.id, "id");
    const client = await getClient();
    const result = await setCollectionRemoteSynced(client, collectionId, true);
    const taskPart = result.task_id !== undefined ? ` (task #${result.task_id})` : "";
    const message = result.success
      ? `Collection ${collectionId} is now git-synced${taskPart}.`
      : `Could not update git-sync setting for collection ${collectionId}.`;
    renderSummary(result, syncSettingsUpdateView, message, ctx);
  },
});

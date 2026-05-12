import { z } from "zod";

import type { Client } from "../../core/http/client";
import type { ResourceView } from "../../domain/view";
import { renderItem } from "../../output/render";
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
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Collection id (positive integer)", required: true },
  },
  outputSchema: SyncSettingsUpdateResult,
  examples: [
    "metabase git-sync add-collection 12",
    "metabase git-sync add-collection 12 --json --profile prod",
  ],
  async run({ args, ctx, getClient }) {
    const collectionId = parseId(args.id, "id");
    const client = await getClient();
    const result = await setCollectionRemoteSynced(client, collectionId, true);
    renderItem(result, syncSettingsUpdateView, ctx);
  },
});

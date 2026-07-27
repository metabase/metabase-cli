import { SyncSettingsUpdateResult } from "@metabase/client/domain/git-sync";

import { renderSummary } from "../../output/render";
import { syncSettingsUpdateView } from "../../output/views/git-sync";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "remove-collection",
    description: "Unmark a collection as git-synced; cascades to descendants by location prefix",
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
    "mb git-sync remove-collection 12",
    "mb git-sync remove-collection 12 --json --profile prod",
  ],
  async run({ args, ctx, getClient }) {
    const collectionId = parseId(args.id, "id");
    const mb = await getClient();
    const result = await mb.gitSync.setCollectionSynced(collectionId, false);
    const taskPart = result.task_id !== undefined ? ` (task #${result.task_id})` : "";
    const message = result.success
      ? `Collection ${collectionId} is no longer git-synced${taskPart}.`
      : `Could not update git-sync setting for collection ${collectionId}.`;
    renderSummary(result, syncSettingsUpdateView, message, ctx);
  },
});

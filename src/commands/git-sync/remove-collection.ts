import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import {
  setCollectionRemoteSynced,
  SyncSettingsUpdateResult,
  syncSettingsUpdateView,
} from "./add-collection";

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
    const client = await getClient();
    const result = await setCollectionRemoteSynced(client, collectionId, false);
    renderItem(result, syncSettingsUpdateView, ctx);
  },
});

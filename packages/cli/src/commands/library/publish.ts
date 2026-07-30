import { z } from "zod";

import { Collection, CollectionCompact } from "@metabase/client/domain/collection";
import type { ResourceView } from "../../output/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { warnIfOutsideSyncScope } from "../git-sync/sync-scope";
import { defineMetabaseCommand } from "../runtime";

import { parseTableSelectors, tableSelectorFlags } from "./selectors";

export const LibraryPublishResult = z.object({
  target_collection: Collection.nullable(),
});
type LibraryPublishResultJson = z.infer<typeof LibraryPublishResult>;

const LibraryPublishResultCompact = z.object({
  target_collection: CollectionCompact.nullable(),
});

const libraryPublishResultView: ResourceView<LibraryPublishResultJson> = {
  compactPick: LibraryPublishResultCompact,
  tableColumns: [{ key: "target_collection", label: "Target collection" }],
};

export default defineMetabaseCommand({
  meta: {
    name: "publish",
    description: "Publish tables (and their upstream dependencies) to the Library Data collection",
  },
  details:
    "Sets each selected table and every upstream table it depends on into the Library Data collection, so they appear first in data pickers and rank up in search. The Library Data collection is resolved automatically (and the Library is created if it doesn't exist yet). Select with --table-ids, --db-ids, or --schemas (each schema id is \"<db-id>:<schema>\", e.g. 1:public); the filters are combined. Publishing does not add the Library Data collection to the git-sync scope — on an instance with remote sync configured, run `mb git-sync add-collection <collection-id>` so exports carry the published tables' metadata.",
  capabilities: { minVersion: 59, tokenFeature: "library" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...tableSelectorFlags,
  },
  outputSchema: LibraryPublishResult,
  examples: [
    "mb library publish --table-ids 1,2,3",
    "mb library publish --db-ids 1 --json",
    "mb library publish --schemas 1:public,1:analytics",
  ],
  async run({ args, ctx, getClient }) {
    const selectors = parseTableSelectors(args);
    const client = await getClient();
    const collectionId = await client.library.ensureDataCollectionId();
    const target = await client.library.publishTables({
      collection_id: collectionId,
      ...selectors,
    });

    const result: LibraryPublishResultJson = { target_collection: target };
    renderSummary(result, libraryPublishResultView, summaryLine(result), ctx);
    await warnIfOutsideSyncScope(client, target);
  },
});

function summaryLine(result: LibraryPublishResultJson): string {
  const collection = result.target_collection;
  if (collection === null) {
    return "Published tables to the Library.";
  }
  return `Published tables to the Library (collection ${collection.id} "${collection.name}").`;
}

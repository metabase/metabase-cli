import { z } from "zod";

import { ConfigError } from "../../core/errors";
import { Collection, CollectionCompact } from "../../domain/collection";
import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { parseTableSelectors, tableSelectorFlags, type TableSelectors } from "./selectors";

export const TablePublishResult = z.object({
  target_collection: Collection.nullable(),
});
type TablePublishResultJson = z.infer<typeof TablePublishResult>;

const TablePublishResultCompact = z.object({
  target_collection: CollectionCompact.nullable(),
});

const tablePublishResultView: ResourceView<TablePublishResultJson> = {
  compactPick: TablePublishResultCompact,
  tableColumns: [{ key: "target_collection", label: "Target collection" }],
};

interface PublishRequestBody extends TableSelectors {
  collection_id: number;
}

export default defineMetabaseCommand({
  meta: {
    name: "publish",
    description: "Publish tables (and their upstream dependencies) to a library collection",
  },
  details:
    'Sets the collection for each selected table and recursively for every upstream table it depends on, surfacing them as trusted data sources in the library. Select tables with --table-ids, whole databases with --db-ids, or schemas with --schemas (each schema id is "<db-id>:<schema>", e.g. 1:public); the filters are combined. The target must be a `library-data` collection.',
  capabilities: { minVersion: 59, tokenFeature: "library" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    "collection-id": { type: "string", description: "Target library collection id" },
    ...tableSelectorFlags,
  },
  outputSchema: TablePublishResult,
  examples: [
    "mb table publish --collection-id 12 --table-ids 1,2,3",
    "mb table publish --collection-id 12 --db-ids 1 --json",
    "mb table publish --collection-id 12 --schemas 1:public,1:analytics",
  ],
  async run({ args, ctx, getClient }) {
    const collectionRaw = args["collection-id"];
    if (collectionRaw === undefined || collectionRaw === "") {
      throw new ConfigError("provide a target library collection with --collection-id <id>");
    }
    const collectionId = parseId(collectionRaw, "collection id");
    const selectors = parseTableSelectors(args);
    const body: PublishRequestBody = { collection_id: collectionId, ...selectors };

    const client = await getClient();
    const result = await client.requestParsed(
      TablePublishResult,
      "/api/ee/data-studio/table/publish-tables",
      { method: "POST", body },
    );

    renderSummary(result, tablePublishResultView, summaryLine(result), ctx);
  },
});

function summaryLine(result: TablePublishResultJson): string {
  const collection = result.target_collection;
  if (collection === null) {
    return "Published tables to the library.";
  }
  return `Published tables to collection ${collection.id} "${collection.name}".`;
}

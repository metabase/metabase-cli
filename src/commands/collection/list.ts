import { z } from "zod";

import { Collection, CollectionCompact, collectionView } from "../../domain/collection";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const CollectionApiList = z.array(Collection);

const CollectionListFilter = z.enum(["all", "archived", "personal"]);

const COLLECTION_LIST_QUERY = {
  all: {},
  archived: { archived: true },
  personal: { "personal-only": true },
} as const;

export const CollectionListEnvelope = listEnvelopeSchema(CollectionCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List collections" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    filter: {
      type: "string",
      description: `Filter preset: ${CollectionListFilter.options.join("|")}`,
      default: "all",
    },
  },
  outputSchema: CollectionListEnvelope,
  examples: [
    "mb collection list",
    "mb collection list --json",
    "mb collection list --filter archived --json",
  ],
  async run({ args, ctx, getClient }) {
    const filter = CollectionListFilter.parse(args.filter);
    const client = await getClient();
    const items = await client.requestParsed(CollectionApiList, "/api/collection", {
      query: COLLECTION_LIST_QUERY[filter],
    });
    renderList(wrapList(items), collectionView, ctx);
  },
});

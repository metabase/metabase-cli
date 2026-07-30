import { CollectionCompact, CollectionListFilter } from "@metabase/client/domain/collection";

import { collectionView } from "../../output/views/collection";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";

export const CollectionListEnvelope = listEnvelopeSchema(CollectionCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List collections" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
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
    const filter = parseEnumFlag(args.filter, CollectionListFilter, "filter");
    const client = await getClient();
    const collections = await client.collection.list({ filter });
    renderList(windowList(collections.data, ctx.range), collectionView, ctx);
  },
});

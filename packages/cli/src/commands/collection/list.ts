import {
  CollectionCompact,
  CollectionListFilter,
  CollectionNamespace,
} from "@metabase/client/domain/collection";

import { collectionView } from "../../output/views/collection";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { givenValue } from "../../runtime/input";
import { defineMetabaseCommand } from "../runtime";

export const CollectionListEnvelope = listEnvelopeSchema(CollectionCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List collections" },
  requires: ["collection.list"],
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
    namespace: {
      type: "string",
      description: `List one namespace's collections: ${CollectionNamespace.options.join("|")} (omit for normal collections)`,
    },
  },
  outputSchema: CollectionListEnvelope,
  examples: [
    "mb collection list",
    "mb collection list --json",
    "mb collection list --filter archived --json",
    "mb collection list --namespace transforms --json",
  ],
  async run({ args, ctx, getClient }) {
    const filter = parseEnumFlag(args.filter, CollectionListFilter, "filter");
    const namespaceFlag = givenValue(args.namespace);
    const namespace =
      namespaceFlag === null
        ? undefined
        : parseEnumFlag(namespaceFlag, CollectionNamespace, "namespace");
    const client = await getClient();
    const collections = await client.collection.list({ filter, namespace });
    renderList(windowList(collections.data, ctx.range), collectionView, ctx);
  },
});

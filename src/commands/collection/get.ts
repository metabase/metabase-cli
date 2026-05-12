import { Collection, collectionView } from "../../domain/collection";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { parseCollectionRef } from "./parse-ref";

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: 'Get a collection by id, 21-char entity id, or "root"/"trash"',
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: {
      type: "positional",
      description: 'Collection id, 21-char entity id, or one of: "root", "trash"',
      required: true,
    },
  },
  outputSchema: Collection,
  examples: [
    "metabase collection get 4",
    "metabase collection get root --json",
    "metabase collection get trash --json",
    "metabase collection get voo1If9y8Sld0lXej6xl0 --json",
  ],
  async run({ args, ctx, getClient }) {
    const ref = parseCollectionRef(args.id);
    const client = await getClient();
    const collection = await client.requestParsed(Collection, `/api/collection/${ref}`);
    renderItem(collection, collectionView, ctx);
  },
});

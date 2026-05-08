import { Collection, CollectionCreateInput, collectionView } from "../../domain/collection";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a collection from a JSON spec" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Collection,
  examples: [
    "cat collection.json | metabase collection create",
    "metabase collection create --file collection.json",
    'metabase collection create --body \'{"name":"My Collection","parent_id":4}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, CollectionCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Collection, "/api/collection", {
      method: "POST",
      body,
    });
    renderItem(created, collectionView, ctx);
  },
});

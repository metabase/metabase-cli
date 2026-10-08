import { Collection, CollectionCreateInput } from "@metabase/client/domain/collection";
import { collectionView } from "../../output/views/collection";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { namespaceFlag, parseNamespaceFlag } from "./namespace-flag";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a collection from a JSON spec" },
  details:
    'Body keys: `name` (required), `description`, `parent_id`, `authority_level`, `namespace`. Most collections use the default namespace (omit it). Pass `namespace: "transforms"` (or `--namespace transforms`) to create the kind of collection a transform\'s `collection_id` can point at, and `namespace: "data-actions"` for the folder a data action\'s `collection_id` can point at — a regular collection is rejected there.',
  requires: ["collection.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...namespaceFlag,
  },
  inputSchema: CollectionCreateInput,
  outputSchema: Collection,
  examples: [
    "cat collection.json | mb collection create",
    "mb collection create --file collection.json",
    'mb collection create --body \'{"name":"My Collection","parent_id":4}\'',
    'mb collection create --body \'{"name":"ETL"}\' --namespace transforms',
    'mb collection create --body \'{"name":"Billing"}\' --namespace data-actions',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, CollectionCreateInput);
    const namespace = parseNamespaceFlag(args.namespace);
    if (namespace !== undefined) {
      body.namespace = namespace;
    }
    const client = await getClient();
    const created = await client.collection.create(body);
    renderSummary(
      created,
      collectionView,
      `Created collection ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

import {
  Collection,
  CollectionCreateInput,
  CollectionNamespace,
  collectionView,
} from "../../domain/collection";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a collection from a JSON spec" },
  details:
    'Body keys: `name` (required), `description`, `parent_id`, `authority_level`, `namespace`. Most collections use the default namespace (omit it). Pass `namespace: "transforms"` (or `--namespace transforms`) to create the kind of collection a transform\'s `collection_id` can point at — a regular collection is rejected there.',
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    namespace: {
      type: "string",
      description: `Collection namespace: ${CollectionNamespace.options.join("|")} (omit for a normal collection)`,
    },
  },
  outputSchema: Collection,
  examples: [
    "cat collection.json | mb collection create",
    "mb collection create --file collection.json",
    'mb collection create --body \'{"name":"My Collection","parent_id":4}\'',
    'mb collection create --body \'{"name":"ETL"}\' --namespace transforms',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, CollectionCreateInput);
    if (typeof args.namespace === "string" && args.namespace !== "") {
      body.namespace = parseEnumFlag(args.namespace, CollectionNamespace, "namespace");
    }
    const client = await getClient();
    const created = await client.requestParsed(Collection, "/api/collection", {
      method: "POST",
      body,
    });
    renderSummary(
      created,
      collectionView,
      `Created collection ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

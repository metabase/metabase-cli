import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { CollectionNamespace, CollectionTreeNode } from "@metabase/client/domain/collection";
import { writeJson } from "../../output/render";
import { parseEnum } from "../../runtime/csv";
import { connectionFlags, formatFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const CollectionTreeResponse = z.array(CollectionTreeNode);

export default defineMetabaseCommand({
  meta: {
    name: "tree",
    description: "Fetch the collection hierarchy as a nested tree (JSON only)",
  },
  requires: ["collection.tree"],
  args: {
    ...formatFlags,
    ...profileFlag,
    ...connectionFlags,
    "include-library": {
      type: "boolean",
      description: "Include the Library collections, which the tree leaves out by default",
    },
    namespace: {
      type: "string",
      description: `Collection namespace: ${CollectionNamespace.options.join("|")} (omit for a normal collection)`,
    },
  },
  outputSchema: CollectionTreeResponse,
  examples: [
    "mb collection tree",
    "mb collection tree --json",
    "mb collection tree --include-library",
    "mb collection tree --namespace data-actions",
  ],
  async run({ args, ctx, getClient }) {
    if (ctx.format === "text") {
      throw new ConfigError("collection tree output is JSON-only; --format text is not supported");
    }
    const client = await getClient();
    const tree = await client.collection.tree({
      "include-library": args["include-library"] ? true : undefined,
      namespace: parseEnum(args.namespace, CollectionNamespace, "--namespace"),
    });
    writeJson(tree.data);
  },
});

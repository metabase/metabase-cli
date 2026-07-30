import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { CollectionTreeNode } from "@metabase/client/domain/collection";
import { writeJson } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const CollectionTreeResponse = z.array(CollectionTreeNode);

export default defineMetabaseCommand({
  meta: {
    name: "tree",
    description: "Fetch the collection hierarchy as a nested tree (JSON only)",
  },
  capabilities: { minVersion: 58 },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: CollectionTreeResponse,
  examples: ["mb collection tree", "mb collection tree --json"],
  async run({ ctx, getClient }) {
    if (ctx.format === "text") {
      throw new ConfigError("collection tree output is JSON-only; --format text is not supported");
    }
    const client = await getClient();
    const tree = await client.collection.tree();
    writeJson(tree.data);
  },
});

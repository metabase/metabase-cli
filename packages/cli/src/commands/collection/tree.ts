import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { CollectionTreeNode } from "@metabase/client/domain/collection";
import { writeJson } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export const CollectionTreeResponse = z.array(CollectionTreeNode);

export default defineMetabaseCommand({
  meta: {
    name: "tree",
    description: "Fetch the collection hierarchy as a nested tree (JSON only)",
  },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...worktreeFlag },
  outputSchema: CollectionTreeResponse,
  examples: [
    "mb collection tree",
    "mb collection tree --json",
    "mb collection tree --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    if (ctx.format === "text") {
      throw new ConfigError("collection tree output is JSON-only; --format text is not supported");
    }
    const client = await getClient();
    const scope = await getWorktree();
    const tree = await client.collection.tree(scopeQuery(scope));
    writeJson(tree.data);
  },
});

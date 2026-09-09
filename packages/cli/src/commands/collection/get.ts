import { Collection } from "@metabase/client/domain/collection";
import { collectionView } from "../../output/views/collection";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { isCollectionAlias, parseCollectionRef } from "./parse-ref";

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: 'Get a collection by id, 21-char entity id, or "root"/"trash"',
  },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details:
    'The "root" and "trash" aliases name pseudo-collections the server assembles, so a scope does ' +
    "not apply to them. " +
    WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    id: {
      type: "positional",
      description: 'Collection id, 21-char entity id, or one of: "root", "trash"',
      required: true,
    },
  },
  outputSchema: Collection,
  examples: [
    "mb collection get 4",
    "mb collection get root --json",
    "mb collection get trash --json",
    "mb collection get voo1If9y8Sld0lXej6xl0 --json",
    "mb collection get 4 --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const ref = parseCollectionRef(args.id);
    const client = await getClient();
    const scope = await getWorktree();
    const collection = await client.collection.get(ref);
    if (!isCollectionAlias(ref)) {
      assertInWorktree("collection", ref, collection.worktree_id, scope);
    }
    renderItem(collection, collectionView, ctx);
  },
});

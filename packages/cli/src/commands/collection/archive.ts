import { Collection } from "@metabase/client/domain/collection";
import { collectionView } from "../../output/views/collection";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a collection by id" },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    id: { type: "positional", description: "Collection id", required: true },
  },
  outputSchema: Collection,
  examples: ["mb collection archive 4", "mb collection archive 4 --json"],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const client = await getClient();
    const scope = await getWorktree();
    if (scope !== null) {
      const existing = await client.collection.get(id);
      assertInWorktree("collection", id, existing.worktree_id, scope);
    }
    const updated = await client.collection.archive(id);
    renderSummary(
      updated,
      collectionView,
      `Archived collection ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});

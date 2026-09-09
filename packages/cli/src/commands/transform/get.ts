import { Transform } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a transform by id" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: Transform,
  examples: [
    "mb transform get 1",
    "mb transform get 1 --json",
    "mb transform get 1 --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const client = await getClient();
    const scope = await getWorktree();
    const transform = await client.transform.get(id);
    assertInWorktree("transform", id, transform.worktree_id, scope);
    renderItem(transform, transformView, ctx);
  },
});

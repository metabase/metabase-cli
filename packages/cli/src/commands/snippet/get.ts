import { Snippet } from "@metabase/client/domain/snippet";
import { snippetView } from "../../output/views/snippet";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a native query snippet by id" },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    id: { type: "positional", description: "Snippet id", required: true },
  },
  outputSchema: Snippet,
  examples: [
    "mb snippet get 1",
    "mb snippet get 1 --json",
    "mb snippet get 1 --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const client = await getClient();
    const scope = await getWorktree();
    const snippet = await client.snippet.get(id);
    assertInWorktree("snippet", id, snippet.worktree_id, scope);
    renderItem(snippet, snippetView, ctx);
  },
});

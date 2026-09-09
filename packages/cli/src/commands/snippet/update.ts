import { Snippet, SnippetUpdateInput } from "@metabase/client/domain/snippet";
import { snippetView } from "../../output/views/snippet";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a native query snippet by id" },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    ...bodyInputFlags,
    id: { type: "positional", description: "Snippet id", required: true },
  },
  inputSchema: SnippetUpdateInput,
  outputSchema: Snippet,
  examples: [
    "cat patch.json | mb snippet update 1",
    "mb snippet update 1 --file patch.json",
    'mb snippet update 1 --body \'{"name":"renamed"}\'',
    "mb snippet update 1 --body '{\"archived\":true}'",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, SnippetUpdateInput);
    const client = await getClient();
    const scope = await getWorktree();
    if (scope !== null) {
      const existing = await client.snippet.get(id);
      assertInWorktree("snippet", id, existing.worktree_id, scope);
    }
    const updated = await client.snippet.update(id, body);
    renderSummary(updated, snippetView, `Updated snippet ${updated.id} "${updated.name}".`, ctx);
  },
});

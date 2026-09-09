import { Snippet, SnippetCreateInput } from "@metabase/client/domain/snippet";
import { snippetView } from "../../output/views/snippet";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeBody, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a native query snippet from a JSON spec" },
  capabilities: { minVersion: 58 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    ...bodyInputFlags,
  },
  inputSchema: SnippetCreateInput,
  outputSchema: Snippet,
  examples: [
    "cat snippet.json | mb snippet create",
    "mb snippet create --file snippet.json",
    'mb snippet create --body \'{"name":"active","content":"WHERE active = true"}\'',
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const body = await readBody({ flag: args.body, file: args.file }, SnippetCreateInput);
    const client = await getClient();
    const scope = await getWorktree();
    const created = await client.snippet.create(scopeBody(body, scope));
    renderSummary(created, snippetView, `Created snippet ${created.id} "${created.name}".`, ctx);
  },
});

import { Library } from "@metabase/client/domain/library";
import { libraryView } from "../../output/views/library";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeQuery, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: {
    name: "get",
    description: "Show the Library and its Data / Metrics collection ids",
  },
  details:
    "Reads the Library root and its child collections. Use the `library-data` child's id as the target for publishing tables (or just run `mb library publish`, which resolves it for you). " +
    WORKTREE_SCOPE_DETAIL,
  capabilities: { minVersion: 59, tokenFeature: "library" },
  worktree: "scoped",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
  },
  outputSchema: Library,
  examples: [
    "mb library get",
    "mb library get --json",
    "mb library get --worktree feat/transforms",
  ],
  async run({ ctx, getClient, getWorktree }) {
    const client = await getClient();
    const scope = await getWorktree();
    const library = await client.library.get(scopeQuery(scope));
    if (library === null) {
      throw new Error(
        "The Library has not been created yet — run `mb library create` (or publish a table with `mb library publish`).",
      );
    }
    renderItem(library, libraryView, ctx);
  },
});

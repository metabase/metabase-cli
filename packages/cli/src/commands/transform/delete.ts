import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform by id" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform delete 1 --yes", "mb transform delete 1"],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const client = await getClient();
    const scope = await getWorktree();
    if (scope !== null) {
      const existing = await client.transform.get(id);
      assertInWorktree("transform", id, existing.worktree_id, scope);
    }
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete transform ${id}?`,
      successMessage: `Deleted transform ${id}.`,
      abortMessage: `Aborted; transform ${id} was not deleted.`,
      deleteResource: () => client.transform.delete(id),
      ctx,
    });
  },
});

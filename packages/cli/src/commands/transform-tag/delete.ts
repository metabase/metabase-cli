import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { assertTagInWorktree } from "./scope";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform tag by id" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform tag id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform-tag delete 5 --yes", "mb transform-tag delete 5"],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const client = await getClient();
    await assertTagInWorktree(client, id, await getWorktree());
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete transform tag ${id}?`,
      successMessage: `Deleted transform tag ${id}.`,
      abortMessage: `Aborted; transform tag ${id} was not deleted.`,
      deleteResource: () => client.transformTag.delete(id),
      ctx,
    });
  },
});

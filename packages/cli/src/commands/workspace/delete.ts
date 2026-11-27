import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a workspace by id" },
  details:
    "Tears down each database's warehouse isolation, then deletes the workspace. When a teardown fails, the workspace is kept with the databases that failed, so the delete can be run again. `--force` deletes the databases whose teardown failed without tearing them down, and the server logs what the warehouse may still hold of them; use it only when the warehouse is gone for good. The other databases are torn down as without it.",
  requires: ["workspaceManager.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    force: {
      type: "boolean",
      description: "Delete the databases whose teardown failed without tearing them down",
      default: false,
    },
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: DeleteResult,
  examples: [
    "mb workspace delete 3 --yes",
    "mb workspace delete 3",
    "mb workspace delete 3 --yes --force",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete workspace ${id} and tear down its databases?`,
      successMessage: `Deleted workspace ${id}.`,
      abortMessage: `Aborted; workspace ${id} was not deleted.`,
      deleteResource: () => client.workspaceManager.delete(id, args.force ? { force: true } : {}),
      ctx,
    });
  },
});

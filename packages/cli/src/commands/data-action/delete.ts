import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a data action by id" },
  requires: ["dataAction.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Data action id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb data-action delete 1 --yes", "mb data-action delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete data action ${id}?`,
      successMessage: `Deleted data action ${id}.`,
      abortMessage: `Aborted; data action ${id} was not deleted.`,
      deleteResource: () => client.dataAction.delete(id),
      ctx,
    });
  },
});

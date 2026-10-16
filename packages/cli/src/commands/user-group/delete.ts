import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a permission group by id" },
  details:
    "Deletes the group with its memberships and permissions; its members keep their other groups. The built-in All Users and Administrators groups cannot be deleted. Admins only.",
  requires: ["group.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Group id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb group delete 3 --yes", "mb group delete 3"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete group ${id}?`,
      successMessage: `Deleted group ${id}.`,
      abortMessage: `Aborted; group ${id} was not deleted.`,
      deleteResource: () => client.group.delete(id),
      ctx,
    });
  },
});

import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a glossary entry by id" },
  requires: ["glossary.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Glossary entry id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb glossary delete 3 --yes", "mb glossary delete 3"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete glossary entry ${id}?`,
      successMessage: `Deleted glossary entry ${id}.`,
      abortMessage: `Aborted; glossary entry ${id} was not deleted.`,
      deleteResource: () => client.glossary.delete(id),
      ctx,
    });
  },
});

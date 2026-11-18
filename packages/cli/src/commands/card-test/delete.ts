import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a card test by id" },
  requires: ["cardTest.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Card test id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb card-test delete 1 --yes", "mb card-test delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete card test ${id}?`,
      successMessage: `Deleted card test ${id}.`,
      abortMessage: `Aborted; card test ${id} was not deleted.`,
      deleteResource: () => client.cardTest.delete(id),
      ctx,
    });
  },
});

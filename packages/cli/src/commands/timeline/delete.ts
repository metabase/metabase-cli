import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "delete",
    description: "Permanently delete a timeline and all its events by id",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Timeline id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb timeline delete 1 --yes", "mb timeline delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/timeline/${id}`,
      yes: args.yes,
      promptMessage: `Delete timeline ${id} and all its events?`,
      successMessage: `Deleted timeline ${id}.`,
      abortMessage: `Aborted; timeline ${id} was not deleted.`,
      client,
      ctx,
    });
  },
});

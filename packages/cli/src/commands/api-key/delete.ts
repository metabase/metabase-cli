import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete an API key by id" },
  details: "Only admins can delete API keys. Any request that uses the key fails after that.",
  requires: ["apiKey.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "API key id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb api-key delete 3 --yes"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete API key ${id}? Requests made with it will fail.`,
      successMessage: `Deleted API key ${id}.`,
      abortMessage: `Aborted; API key ${id} was not deleted.`,
      deleteResource: () => client.apiKey.delete(id),
      ctx,
    });
  },
});

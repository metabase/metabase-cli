import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Mark an index request for deletion by id" },
  capabilities: { minVersion: 64 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Index request id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform-index delete 1 --yes", "mb transform-index delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/index/request/${id}`,
      yes: args.yes,
      promptMessage: `Delete index request ${id}? The physical index drops on the next full rebuild.`,
      successMessage: `Marked index request ${id} for deletion; it drops on the next full rebuild.`,
      abortMessage: `Aborted; index request ${id} was not deleted.`,
      client,
      ctx,
    });
  },
});

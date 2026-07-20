import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "delete-table",
    description: "Drop a transform's materialized output table (keeps the transform definition)",
  },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform delete-table 1 --yes", "mb transform delete-table 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/transform/${id}/table`,
      yes: args.yes,
      promptMessage: `Drop transform ${id}'s output table?`,
      successMessage: `Dropped transform ${id}'s output table.`,
      abortMessage: `Aborted; transform ${id}'s output table was not dropped.`,
      client,
      ctx,
    });
  },
});

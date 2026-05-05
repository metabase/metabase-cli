import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform job by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["metabase transform-job delete 1 --yes", "metabase transform-job delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/transform-job/${id}`,
      yes: args.yes,
      promptMessage: `Delete transform job ${id}?`,
      client,
      ctx,
    });
  },
});

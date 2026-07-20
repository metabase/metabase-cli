import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform job by id" },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform-job delete 1 --yes", "mb transform-job delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/transform-job/${id}`,
      yes: args.yes,
      promptMessage: `Delete transform job ${id}?`,
      successMessage: `Deleted transform job ${id}.`,
      abortMessage: `Aborted; transform job ${id} was not deleted.`,
      client,
      ctx,
    });
  },
});

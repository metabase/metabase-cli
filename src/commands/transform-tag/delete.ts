import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform tag by id" },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform tag id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform-tag delete 5 --yes", "mb transform-tag delete 5"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/transform-tag/${id}`,
      yes: args.yes,
      promptMessage: `Delete transform tag ${id}?`,
      successMessage: `Deleted transform tag ${id}.`,
      abortMessage: `Aborted; transform tag ${id} was not deleted.`,
      client,
      ctx,
    });
  },
});

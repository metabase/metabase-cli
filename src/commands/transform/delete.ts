import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform by id" },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform delete 1 --yes", "mb transform delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      path: `/api/transform/${id}`,
      yes: args.yes,
      promptMessage: `Delete transform ${id}?`,
      client,
      ctx,
    });
  },
});

import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a transform test by id" },
  requires: ["transformTest.delete"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Transform test id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb transform-test delete 5 --yes", "mb transform-test delete 5"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete transform test ${id}?`,
      successMessage: `Deleted transform test ${id}.`,
      abortMessage: `Aborted; transform test ${id} was not deleted.`,
      deleteResource: () => client.transformTest.delete(id),
      ctx,
    });
  },
});

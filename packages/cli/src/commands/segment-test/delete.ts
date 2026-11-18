import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a segment test by id" },
  requires: ["segmentTest.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "positional", description: "Segment test id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb segment-test delete 1 --yes", "mb segment-test delete 1"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete segment test ${id}?`,
      successMessage: `Deleted segment test ${id}.`,
      abortMessage: `Aborted; segment test ${id} was not deleted.`,
      deleteResource: () => client.segmentTest.delete(id),
      ctx,
    });
  },
});

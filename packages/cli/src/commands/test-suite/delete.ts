import { interruptSignal } from "../../runtime/interrupt";
import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a test suite by id" },
  details:
    "Deleting a suite keeps the tests in it. On an instance where remote sync keeps synced content read-only, the server refuses every suite write with a plain 400 that carries no error code.",
  requires: ["testSuite.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "string", description: "Test suite id", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb test-suite delete --id 5 --yes", "mb test-suite delete --id 5"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id, "--id");
    const client = await getClient();
    await confirmAndDelete({
      id,
      yes: args.yes,
      promptMessage: `Delete test suite ${id}?`,
      successMessage: `Deleted test suite ${id}.`,
      abortMessage: `Aborted; test suite ${id} was not deleted.`,
      deleteResource: () => client.testSuite.delete(id, { signal: interruptSignal }),
      ctx,
    });
  },
});

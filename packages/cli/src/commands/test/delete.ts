import { interruptSignal } from "../../runtime/interrupt";
import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseTestRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a data test" },
  requires: ["dataTest.delete"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    yes: { type: "boolean", description: "Skip confirmation", default: false },
    id: { type: "string", description: "The test, such as card-test:34", required: true },
  },
  outputSchema: DeleteResult,
  examples: ["mb test delete --id card-test:34 --yes", "mb test delete --id transform-test:7"],
  async run({ args, ctx, getClient }) {
    const ref = parseTestRef(args.id);
    const text = testRefText(ref);
    const client = await getClient();
    await confirmAndDelete({
      id: ref.id,
      yes: args.yes,
      promptMessage: `Delete ${text}?`,
      successMessage: `Deleted ${text}.`,
      abortMessage: `Aborted; ${text} was not deleted.`,
      deleteResource: () => client.dataTest.delete(ref.type, ref.id, { signal: interruptSignal }),
      ctx,
    });
  },
});

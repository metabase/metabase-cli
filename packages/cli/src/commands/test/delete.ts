import { interruptSignal } from "../../runtime/interrupt";
import { confirmAndDelete, DeleteResult } from "../delete-runtime";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseTestRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "delete", description: "Delete a data test" },
  requires: [
    "transformTest.delete",
    "cardTest.delete",
    "segmentTest.delete",
    "measureTest.delete",
    "actionTest.delete",
  ],
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
    function deleteTest(): Promise<void> {
      const options = { signal: interruptSignal };
      switch (ref.type) {
        case "transform": {
          return client.transformTest.delete(ref.id, options);
        }
        case "card": {
          return client.cardTest.delete(ref.id, options);
        }
        case "segment": {
          return client.segmentTest.delete(ref.id, options);
        }
        case "measure": {
          return client.measureTest.delete(ref.id, options);
        }
        case "action": {
          return client.actionTest.delete(ref.id, options);
        }
      }
    }
    await confirmAndDelete({
      id: ref.id,
      yes: args.yes,
      promptMessage: `Delete ${text}?`,
      successMessage: `Deleted ${text}.`,
      abortMessage: `Aborted; ${text} was not deleted.`,
      deleteResource: () => deleteTest(),
      ctx,
    });
  },
});

import { renderSummary } from "../../output/render";
import { AnyTest } from "../../core/data-test";
import { anyTestView } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseTestRef, testRefText } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";
import { refuseForeignFields, TestPatch } from "./body";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a data test from JSON" },
  details:
    "Only the fields the body carries are patched; `inputs` and `expectations` replace what is stored.",
  requires: ["dataTest.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "string", description: "The test, such as card-test:34", required: true },
  },
  inputSchema: TestPatch,
  outputSchema: AnyTest,
  examples: [
    "mb test update --id card-test:34 --file patch.json",
    'mb test update --id segment-test:2 --body \'{"name":"renamed"}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const ref = parseTestRef(args.id);
    const patch = await readBody({ flag: args.body, file: args.file });
    refuseForeignFields(ref, patch);
    const client = await getClient();
    const updated = await client.dataTest.update(ref.type, ref.id, patch, {
      signal: interruptSignal,
    });
    renderSummary(updated, anyTestView, `Updated ${testRefText(ref)}.`, ctx);
  },
});

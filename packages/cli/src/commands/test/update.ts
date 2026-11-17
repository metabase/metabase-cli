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
    "--id names the test as `<type>-test:<id>` (`card-test:34`). Only the fields the body carries are patched; `inputs` and `expectations` replace what is stored rather than merging into it. The body takes the fields `create` does, is closed at every level, and cannot move the test to another entity.",
  requires: [
    "transformTest.update",
    "cardTest.update",
    "segmentTest.update",
    "measureTest.update",
    "actionTest.update",
  ],
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
    function updateTest(): Promise<AnyTest> {
      const { parameters, now, ...fields } = patch;
      const options = { signal: interruptSignal };
      switch (ref.type) {
        case "transform": {
          return client.transformTest.update(ref.id, fields, options);
        }
        case "card": {
          return client.cardTest.update(ref.id, { ...fields, now }, options);
        }
        case "segment": {
          return client.segmentTest.update(ref.id, { ...fields, now }, options);
        }
        case "measure": {
          return client.measureTest.update(ref.id, { ...fields, now }, options);
        }
        case "action": {
          return client.actionTest.update(ref.id, { ...fields, now, parameters }, options);
        }
      }
    }
    const updated = await updateTest();
    renderSummary(updated, anyTestView, `Updated ${testRefText(ref)}.`, ctx);
  },
});

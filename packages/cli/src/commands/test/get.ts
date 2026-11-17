import { renderItem } from "../../output/render";
import { AnyTest, anyTestView } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseTestRef } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a data test" },
  details:
    "--id names the test as `<type>-test:<id>` (`card-test:34`). The compact form carries the id, the entity it tests, the name and the description. Pass --full for the `inputs` and `expectations`, which are also the body to edit and send back to `update` once `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and the entity's id are shed.",
  requires: [
    "transformTest.get",
    "cardTest.get",
    "segmentTest.get",
    "measureTest.get",
    "actionTest.get",
  ],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "string", description: "The test, such as card-test:34", required: true },
  },
  outputSchema: AnyTest,
  examples: ["mb test get --id card-test:34", "mb test get --id transform-test:7 --full --json"],
  async run({ args, ctx, getClient }) {
    const ref = parseTestRef(args.id);
    const client = await getClient();
    function getTest(): Promise<AnyTest> {
      const options = { signal: interruptSignal };
      switch (ref.type) {
        case "transform": {
          return client.transformTest.get(ref.id, options);
        }
        case "card": {
          return client.cardTest.get(ref.id, options);
        }
        case "segment": {
          return client.segmentTest.get(ref.id, options);
        }
        case "measure": {
          return client.measureTest.get(ref.id, options);
        }
        case "action": {
          return client.actionTest.get(ref.id, options);
        }
      }
    }
    renderItem(await getTest(), anyTestView, ctx);
  },
});

import { renderItem } from "../../output/render";
import { AnyTest } from "../../core/data-test";
import { anyTestView } from "../../output/views/data-test";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseTestRef } from "../test-ref";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a data test" },
  details:
    "Pass --full for every field. To send it back to `update`, keep `name`, `description`, `inputs`, `expectations`, and `now` or `parameters` where the type has them; `update` refuses the rest.",
  requires: ["dataTest.get"],
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
    const test = await client.dataTest.get(ref.type, ref.id, { signal: interruptSignal });
    renderItem(test, anyTestView, ctx);
  },
});

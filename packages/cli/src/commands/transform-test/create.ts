import { TransformTest, TransformTestCreateInput } from "@metabase/client/domain/transform-test";

import { renderSummary } from "../../output/render";
import { transformTestView } from "../../output/views/transform-test";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform test" },
  details:
    "The body names the transform, the input tables (as SQL or as columns and rows) and the expectations (`equals` a table of rows, or `empty`). The server validates inputs and expectations against the transform's SQL before saving; a refusal is an HTTP error whose code starts with `transform-test.`.",
  requires: ["transformTest.create"],
  args: { ...outputFlags, ...preflightFlag, ...bodyInputFlags },
  inputSchema: TransformTestCreateInput,
  outputSchema: TransformTest,
  examples: [
    "mb transform-test create --file test.json",
    'echo \'{"transform_id":3,"name":"keeps paid orders","inputs":[…],"expectations":[…]}\' | mb transform-test create',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformTestCreateInput);
    const client = await getClient();
    const created = await client.transformTest.create(body);
    renderSummary(
      created,
      transformTestView,
      `Created transform test ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

import { TransformTest, TransformTestCreateInput } from "@metabase/client/domain/transform-test";

import { renderSummary } from "../../output/render";
import { transformTestView } from "../../output/views/transform-test";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform test from JSON" },
  details: [
    'The JSON body needs a `transform_id`, a `name`, `inputs` that stand in for every table the transform reads, and `expectations` to check against its output. An input names its `table` and has either `format: "sql"` with a `sql` query, or `format: "rows"` with `columns` (each a `name` and a `cast_type` the warehouse can `CAST` to) and `rows` that carry exactly those columns.',
    'An expectation is either `type: "empty"` with `sql` that must return nothing, or `type: "equals"` with `format: "rows"` and the `columns` and `rows` the output must hold exactly. The body is closed at every level, so a test read with `get --full` must drop `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it\'s sent.',
  ].join("\n\n"),
  requires: ["transformTest.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: TransformTestCreateInput,
  outputSchema: TransformTest,
  examples: [
    "cat transform-test.json | mb transform-test create",
    "mb transform-test create --file transform-test.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
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

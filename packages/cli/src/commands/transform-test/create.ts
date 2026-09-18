import { TransformTest, TransformTestCreateInput } from "@metabase/client/domain/transform-test";

import { renderSummary } from "../../output/render";
import { transformTestView } from "../../output/views/transform-test";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform test from JSON" },
  details:
    'The JSON body needs a `transform_id`, a `name`, the `inputs` standing in for every table the transform reads, and the `expectations` checked against its output. An input names its `table` and carries either `format: "sql"` with a `sql` query or `format: "rows"` with `columns` and `rows`. An expectation is either `type: "empty"` with the `sql` that must return nothing, or `type: "equals"`, which takes the same `format` split as an input: `format: "rows"` with the `columns` and `rows` the output must hold, or `format: "sql"` with a query returning them. The body is closed: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before it can be sent.',
  capabilities: { minVersion: 65 },
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

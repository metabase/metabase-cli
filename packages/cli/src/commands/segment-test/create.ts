import { SegmentTest, SegmentTestCreateInput } from "@metabase/client/domain/segment-test";

import { renderSummary } from "../../output/render";
import { segmentTestView } from "../../output/views/segment-test";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a segment test from JSON" },
  details:
    'The JSON body needs a `segment_id`, a `name`, the `inputs` and the `expectations`. The test needs an input for the segment\'s table and one for each table the segment\'s filter reads through a foreign key. An input names its `table` and carries either `format: "sql"` with a `sql` query or `format: "rows"` with `columns` and `rows`. An expectation is either `type: "empty"` with the `sql` that must return nothing, or `type: "equals"` with `format: "rows"` and the `columns` and `rows` the output must hold exactly. The output is the rows of the segment\'s table that match its filter, and expectation SQL names it `{{output}}`; any other `{{...}}` is refused. The output has the columns of the segment\'s table that its `rows` input declares, and every column of the table when that input is SQL. An input that gives rows must declare every column the filter reads from its table. The body is closed at every level: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and `last_run` before it can be sent.',
  requires: ["segmentTest.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: SegmentTestCreateInput,
  outputSchema: SegmentTest,
  examples: [
    "cat segment-test.json | mb segment-test create",
    "mb segment-test create --file segment-test.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.segmentTest.create(body);
    renderSummary(
      created,
      segmentTestView,
      `Created segment test ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

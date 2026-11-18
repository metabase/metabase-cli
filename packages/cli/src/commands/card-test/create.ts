import { CardTest, CardTestCreateInput } from "@metabase/client/domain/card-test";

import { renderSummary } from "../../output/render";
import { cardTestView } from "../../output/views/card-test";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a card test from JSON" },
  details:
    'The JSON body needs a `card_id`, a `name`, the `inputs` standing in for every table the card\'s query reads, and the `expectations` checked against its result. An input names its `table` and carries either `format: "sql"` with a `sql` query or `format: "rows"` with `columns` and `rows`. An expectation is either `type: "empty"` with the `sql` that must return nothing, or `type: "equals"` with `format: "rows"` and the `columns` and `rows` the result must hold exactly. Expectation SQL names the card\'s result `{{output}}`; any other `{{...}}` is refused. The expectations read the result without remapped columns and without the default row limit. A card with a parameter that needs a value and has no default cannot be tested. The body is closed at every level: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and `last_run` before it can be sent.',
  requires: ["cardTest.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: CardTestCreateInput,
  outputSchema: CardTest,
  examples: [
    "cat card-test.json | mb card-test create",
    "mb card-test create --file card-test.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.cardTest.create(body);
    renderSummary(created, cardTestView, `Created card test ${created.id} "${created.name}".`, ctx);
  },
});

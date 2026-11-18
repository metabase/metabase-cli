import { CardTest, CardTestUpdateInput } from "@metabase/client/domain/card-test";

import { renderSummary } from "../../output/render";
import { cardTestView } from "../../output/views/card-test";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a card test from JSON" },
  details:
    "Only the fields the body carries are patched. `inputs` and `expectations` replace what is stored rather than merging into it. The body is closed at every level: a test read back with `get --full` has to shed `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and `last_run` before it can be sent.",
  requires: ["cardTest.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Card test id", required: true },
  },
  inputSchema: CardTestUpdateInput,
  outputSchema: CardTest,
  examples: ["cat patch.json | mb card-test update 1", "mb card-test update 1 --file patch.json"],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.cardTest.update(id, body);
    renderSummary(updated, cardTestView, `Updated card test ${updated.id}.`, ctx);
  },
});

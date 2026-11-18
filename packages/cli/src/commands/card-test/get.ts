import { CardTest } from "@metabase/client/domain/card-test";

import { renderItem } from "../../output/render";
import { cardTestView } from "../../output/views/card-test";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a card test by id" },
  details:
    "The compact form carries the id, card, name and description. Pass --full for the `inputs` and `expectations` themselves and the test's newest run as `last_run`, which is also the body to edit and send back to `update` once `id`, `entity_id`, `creator_id`, `created_at`, `updated_at` and `last_run` are shed.",
  requires: ["cardTest.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card test id", required: true },
  },
  outputSchema: CardTest,
  examples: ["mb card-test get 1", "mb card-test get 1 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const cardTest = await client.cardTest.get(id);
    renderItem(cardTest, cardTestView, ctx);
  },
});

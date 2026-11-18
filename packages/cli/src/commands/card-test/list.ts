import { CardTestCompact } from "@metabase/client/domain/card-test";

import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { cardTestView } from "../../output/views/card-test";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const CardTestListEnvelope = listEnvelopeSchema(CardTestCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List card tests" },
  requires: ["cardTest.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    "card-id": { type: "string", description: "Only the tests of this card id" },
  },
  outputSchema: CardTestListEnvelope,
  examples: ["mb card-test list", "mb card-test list --card-id 1 --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const cardId =
      args["card-id"] === undefined ? undefined : parseId(args["card-id"], "--card-id");
    const { data } = await client.cardTest.list({ "card-id": cardId });
    renderList(windowList(data, ctx.range), cardTestView, ctx);
  },
});

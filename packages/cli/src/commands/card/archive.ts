import { CardDetail } from "@metabase/client/domain/card";
import { cardView } from "../../output/views/card";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a card by id" },
  details:
    "Sets `archived: true`. The card stays readable through `card list --filter archived` and `card get <id>`; `mb card update <id> --body '{\"archived\":false}'` restores it.",
  requires: ["card.archive"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card id", required: true },
  },
  outputSchema: CardDetail,
  examples: ["mb card archive 1", "mb card archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.card.archive(id);
    renderSummary(updated, cardView, `Archived card ${updated.id} "${updated.name}".`, ctx);
  },
});

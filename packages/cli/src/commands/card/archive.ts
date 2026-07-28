import { Card } from "@metabase/client/domain/card";
import { cardView } from "../../output/views/card";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a card by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Card id", required: true },
  },
  outputSchema: Card,
  examples: ["mb card archive 1", "mb card archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.card.archive(id);
    renderSummary(updated, cardView, `Archived card ${updated.id} "${updated.name}".`, ctx);
  },
});

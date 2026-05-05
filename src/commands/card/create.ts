import { Card, CardCreateInput, cardView } from "../../domain/card";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a card from a JSON spec" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Card,
  examples: [
    "cat card.json | metabase card create",
    "metabase card create --file card.json",
    'metabase card create --body \'{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, CardCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Card, "/api/card", {
      method: "POST",
      body,
    });
    renderItem(created, cardView, ctx);
  },
});

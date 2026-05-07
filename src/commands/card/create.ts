import { Card, CardCreateInput, cardView } from "../../domain/card";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { preflightInternalMbql5Query } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description:
      "Create a card from a JSON spec; if dataset_query is MBQL 5 (lib/type: mbql/query) it is pre-flight-validated against the same schema as `metabase query` (see `metabase query --print-schema`)",
  },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Card,
  examples: [
    "cat card.json | metabase card create",
    "metabase card create --file card.json",
    'metabase card create --body \'{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, CardCreateInput);
    preflightInternalMbql5Query(body.dataset_query, "card.dataset_query validation failed");
    const client = await getClient();
    const created = await client.requestParsed(Card, "/api/card", {
      method: "POST",
      body,
    });
    renderItem(created, cardView, ctx);
  },
});

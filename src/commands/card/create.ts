import { Card, CardCreateInput, cardView } from "../../domain/card";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  CARD_DATASET_QUERY_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a card (question, model, or metric) from JSON",
  },
  details:
    "The JSON body needs `name`, `display` (the visualization — e.g. table, bar, scalar), `dataset_query` (the query powering the card), and `visualization_settings` (`{}` is fine). When `dataset_query` is an MBQL 5 query it is checked against a bundled JSON Schema before sending — fix the reported errors, or pass --skip-validate to send anyway. Native-SQL and legacy queries are sent unchecked. See `mb skills get mbql`.",
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  outputSchema: Card,
  examples: [
    "cat card.json | mb card create",
    "mb card create --file card.json",
    'mb card create --body \'{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}\'',
    "mb card create --file card.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, CardCreateInput);
    preflightMbql5Query(body.dataset_query, CARD_DATASET_QUERY_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const created = await client.requestParsed(Card, "/api/card", {
      method: "POST",
      body,
    });
    renderItem(created, cardView, ctx);
  },
});

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
    description:
      "Create a card from a JSON spec; if dataset_query is MBQL 5 (lib/type: mbql/query) it is pre-flight-validated against the same schema as `mb query` (see `mb query --print-schema`)",
  },
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

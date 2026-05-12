import { Card, CardUpdateInput, cardView } from "../../domain/card";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import {
  CARD_DATASET_QUERY_LABELS,
  preflightInternalMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description:
      "Update a card by id; if dataset_query is MBQL 5 (lib/type: mbql/query) it is pre-flight-validated against the same schema as `metabase query` (see `metabase query --print-schema`)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    id: { type: "positional", description: "Card id", required: true },
  },
  outputSchema: Card,
  examples: [
    "cat patch.json | metabase card update 1",
    "metabase card update 1 --file patch.json",
    'metabase card update 1 --body \'{"name":"renamed"}\'',
    'metabase card update 1 --body \'{"display":"bar"}\'',
    "metabase card update 1 --body '{\"archived\":true}'",
    "metabase card update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, CardUpdateInput);
    preflightInternalMbql5Query(body.dataset_query, CARD_DATASET_QUERY_LABELS, {
      skip: args["skip-validate"] === true,
    });
    const client = await getClient();
    const updated = await client.requestParsed(Card, `/api/card/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, cardView, ctx);
  },
});

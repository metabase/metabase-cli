import { Card, CardUpdateInput, cardView } from "../../domain/card";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import {
  CARD_DATASET_QUERY_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a card by id (partial)",
  },
  details:
    "Patches only the fields you send (any of `name`, `display`, `dataset_query`, `collection_id`, `archived`, …). When `dataset_query` is an MBQL 5 query it is checked against a bundled JSON Schema before sending; pass --skip-validate to bypass. See `mb skills get mbql`.",
  capabilities: { minVersion: 58, edition: "oss" },
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
    "cat patch.json | mb card update 1",
    "mb card update 1 --file patch.json",
    'mb card update 1 --body \'{"name":"renamed"}\'',
    'mb card update 1 --body \'{"display":"bar"}\'',
    "mb card update 1 --body '{\"archived\":true}'",
    "mb card update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, CardUpdateInput);
    preflightMbql5Query(body.dataset_query, CARD_DATASET_QUERY_LABELS, {
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

import { CardDetail, CardUpdateInput } from "@metabase/client/domain/card";
import { cardView } from "../../output/views/card";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { CARD_DATASET_QUERY, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a card by id (partial)",
  },
  details:
    "Changes only the fields you send, such as `name`, `display`, `dataset_query`, `visualization_settings`, `description`, `collection_id`, `dashboard_id`, `parameters` or `archived`.",
  skills: [
    { skill: "mbql", purpose: "author the dataset_query" },
    { skill: "visualization", purpose: "choose display and visualization_settings" },
  ],
  requires: ["card.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    id: { type: "positional", description: "Card id", required: true },
  },
  inputSchema: CardUpdateInput,
  embeddedDocuments: [CARD_DATASET_QUERY],
  outputSchema: CardDetail,
  examples: [
    "cat patch.json | mb card update 1",
    "mb card update 1 --file patch.json",
    'mb card update 1 --body \'{"name":"renamed"}\'',
    'mb card update 1 --body \'{"display":"bar"}\'',
    "mb card update 1 --body '{\"archived\":true}'",
    "mb card update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.card.update(id, body);
    renderSummary(updated, cardView, `Updated card ${updated.id} "${updated.name}".`, ctx);
  },
});

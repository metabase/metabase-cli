import { CardDetail, CardCreateInput } from "@metabase/client/domain/card";
import { cardView } from "../../output/views/card";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { CARD_DATASET_QUERY, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a card (question, model, or metric) from JSON",
  },
  details:
    "The JSON body needs `name`, `display` (the visualization, such as `table`, `bar` or `scalar`), `dataset_query`, and `visualization_settings` (`{}` is fine). An MBQL 5 `dataset_query` is checked against the bundled schema (`mb schema query`) before it's sent: fix the errors it reports, or pass `--skip-validate`. Native SQL and legacy queries are sent unchecked.",
  skills: [
    { skill: "mbql", purpose: "author an MBQL dataset_query" },
    { skill: "native-sql", purpose: "author a native SQL dataset_query with parameters" },
    { skill: "visualization", purpose: "choose display and visualization_settings" },
  ],
  requires: ["card.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: CardCreateInput,
  embeddedDocuments: [CARD_DATASET_QUERY],
  outputSchema: CardDetail,
  examples: [
    "cat card.json | mb card create",
    "mb card create --file card.json",
    'mb card create --body \'{"name":"x","display":"table","dataset_query":{...},"visualization_settings":{}}\'',
    "mb card create --file card.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.card.create(body);
    renderSummary(created, cardView, `Created card ${created.id} "${created.name}".`, ctx);
  },
});

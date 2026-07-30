import { CardCompact, CardListFilter } from "@metabase/client/domain/card";
import { cardView } from "../../output/views/card";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";

export const CardListEnvelope = listEnvelopeSchema(CardCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List cards (questions, models, metrics)" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    filter: {
      type: "string",
      description: `Filter preset: ${CardListFilter.options.join("|")}`,
      default: "all",
    },
    modelId: {
      type: "string",
      description: "Used by filter database|table|using_model|using_segment",
      alias: "model-id",
    },
  },
  outputSchema: CardListEnvelope,
  examples: [
    "mb card list",
    "mb card list --filter archived --json",
    "mb card list --filter using_model --model-id 42 --json",
  ],
  async run({ args, ctx, getClient }) {
    const filter = parseEnumFlag(args.filter, CardListFilter, "filter");
    const modelId = args.modelId === undefined || args.modelId === "" ? undefined : args.modelId;
    const client = await getClient();
    const { data, total } = await client.card.list({ f: filter, model_id: modelId });
    renderList(windowList(data, ctx.range, total), cardView, ctx);
  },
});

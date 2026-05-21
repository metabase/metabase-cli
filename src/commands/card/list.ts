import { z } from "zod";

import { Card, CardCompact, cardView } from "../../domain/card";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const CardApiList = z.array(Card);

const CardListFilter = z.enum([
  "all",
  "mine",
  "bookmarked",
  "database",
  "table",
  "archived",
  "using_model",
  "using_segment",
]);

export const CardListEnvelope = listEnvelopeSchema(CardCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List cards (questions, models, metrics)" },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
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
    const filter = CardListFilter.parse(args.filter);
    const modelId = args.modelId === undefined || args.modelId === "" ? undefined : args.modelId;
    const client = await getClient();
    const items = await client.requestParsed(CardApiList, "/api/card", {
      query: { f: filter, model_id: modelId },
    });
    renderList(wrapList(items), cardView, ctx);
  },
});

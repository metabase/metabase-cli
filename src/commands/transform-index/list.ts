import { z } from "zod";

import {
  TransformIndex,
  TransformIndexCompact,
  transformIndexView,
} from "../../domain/transform-index";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TransformIndexApiList = z.object({ data: z.array(TransformIndex) }).loose();

export const TransformIndexListEnvelope = listEnvelopeSchema(TransformIndexCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List a transform's target-table indexes" },
  capabilities: { minVersion: 64 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    transformId: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: TransformIndexListEnvelope,
  examples: ["mb transform-index list 1", "mb transform-index list 1 --json"],
  async run({ args, ctx, getClient }) {
    const transformId = parseId(args.transformId);
    const client = await getClient();
    const response = await client.requestParsed(TransformIndexApiList, "/api/index", {
      query: { "transform-id": transformId },
    });
    renderList(wrapList(response.data), transformIndexView, ctx);
  },
});

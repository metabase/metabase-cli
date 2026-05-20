import { z } from "zod";

import { Transform, TransformCompact, transformView } from "../../domain/transform";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const TransformApiList = z.array(Transform);

export const TransformListEnvelope = listEnvelopeSchema(TransformCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transforms" },
  capabilities: { minVersion: 58, edition: "ee", tokenFeature: "transforms" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: TransformListEnvelope,
  examples: ["mb transform list", "mb transform list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(TransformApiList, "/api/transform");
    renderList(wrapList(items), transformView, ctx);
  },
});

import { z } from "zod";

import { TransformTag, TransformTagCompact, transformTagView } from "../../domain/transform-tag";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const TransformTagApiList = z.array(TransformTag);

export const TransformTagListEnvelope = listEnvelopeSchema(TransformTagCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform tags" },
  capabilities: { minVersion: 59 },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: TransformTagListEnvelope,
  examples: ["mb transform-tag list", "mb transform-tag list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(TransformTagApiList, "/api/transform-tag");
    renderList(wrapList(items), transformTagView, ctx);
  },
});

import { z } from "zod";

import { TransformJob, TransformJobCompact, transformJobView } from "../../domain/transform-job";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const TransformJobApiList = z.array(TransformJob);

export const TransformJobListEnvelope = listEnvelopeSchema(TransformJobCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform jobs" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags },
  outputSchema: TransformJobListEnvelope,
  examples: ["metabase transform-job list", "metabase transform-job list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(TransformJobApiList, "/api/transform-job");
    renderList(wrapList(items), transformJobView, ctx);
  },
});

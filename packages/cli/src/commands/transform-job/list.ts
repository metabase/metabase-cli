import { TransformJobCompact } from "@metabase/client/domain/transform-job";
import { transformJobView } from "../../output/views/transform-job";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const TransformJobListEnvelope = listEnvelopeSchema(TransformJobCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform jobs" },
  capabilities: { minVersion: 59 },
  args: { ...outputFlags, ...listFlags, ...profileFlag, ...connectionFlags },
  outputSchema: TransformJobListEnvelope,
  examples: ["mb transform-job list", "mb transform-job list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data } = await client.transformJob.list();
    renderList(windowList(data, ctx.range), transformJobView, ctx);
  },
});

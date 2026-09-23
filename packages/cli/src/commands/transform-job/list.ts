import { TransformJobCompact } from "@metabase/client/domain/transform-job";
import { transformJobView } from "../../output/views/transform-job";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const TransformJobListEnvelope = listEnvelopeSchema(TransformJobCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List transform jobs" },
  requires: ["transformJob.list"],
  args: { ...outputFlags, ...listFlags, ...preflightFlag },
  outputSchema: TransformJobListEnvelope,
  examples: ["mb transform-job list", "mb transform-job list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data } = await client.transformJob.list();
    renderList(windowList(data, ctx.range), transformJobView, ctx);
  },
});

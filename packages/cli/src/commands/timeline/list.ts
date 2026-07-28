import { TimelineCompact } from "@metabase/client/domain/timeline";
import { timelineView } from "../../output/views/timeline";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const TimelineListEnvelope = listEnvelopeSchema(TimelineCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List timelines" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: { type: "boolean", description: "Show archived timelines instead of active ones" },
  },
  outputSchema: TimelineListEnvelope,
  examples: ["mb timeline list", "mb timeline list --json", "mb timeline list --archived --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.timeline.list({ archived: args.archived || undefined });
    renderList(windowList(data, ctx.range, total), timelineView, ctx);
  },
});

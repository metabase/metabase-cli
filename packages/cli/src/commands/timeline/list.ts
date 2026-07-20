import { z } from "zod";

import { Timeline, TimelineCompact, timelineView } from "../../domain/timeline";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const TimelineApiList = z.array(Timeline);

export const TimelineListEnvelope = listEnvelopeSchema(TimelineCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List timelines" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: { type: "boolean", description: "Show archived timelines instead of active ones" },
  },
  outputSchema: TimelineListEnvelope,
  examples: ["mb timeline list", "mb timeline list --json", "mb timeline list --archived --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const items = await client.requestParsed(TimelineApiList, "/api/timeline", {
      query: { archived: args.archived || undefined },
    });
    renderList(wrapList(items), timelineView, ctx);
  },
});

import { TimelineEventCompact } from "@metabase/client/domain/timeline";
import { timelineEventView } from "../../output/views/timeline";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TimelineEventListEnvelope = listEnvelopeSchema(TimelineEventCompact);

export default defineMetabaseCommand({
  meta: { name: "events", description: "List events on a timeline" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: { type: "boolean", description: "Include archived events" },
    id: { type: "positional", description: "Timeline id", required: true },
  },
  outputSchema: TimelineEventListEnvelope,
  examples: ["mb timeline events 1", "mb timeline events 1 --archived --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data, total } = await client.timeline.events(id, {
      archived: args.archived || undefined,
    });
    renderList(windowList(data, ctx.range, total), timelineEventView, ctx);
  },
});

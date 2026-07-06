import { Timeline, TimelineEventCompact, timelineEventView } from "../../domain/timeline";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TimelineWithEvents = Timeline.required({ events: true });

export const TimelineEventListEnvelope = listEnvelopeSchema(TimelineEventCompact);

export default defineMetabaseCommand({
  meta: { name: "events", description: "List events on a timeline" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
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
    const timeline = await client.requestParsed(TimelineWithEvents, `/api/timeline/${id}`, {
      query: { include: "events", archived: args.archived || undefined },
    });
    renderList(wrapList(timeline.events), timelineEventView, ctx);
  },
});

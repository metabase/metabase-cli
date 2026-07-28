import { TimelineEvent } from "@metabase/client/domain/timeline";
import { timelineEventView } from "../../output/views/timeline";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a timeline event by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Timeline event id", required: true },
  },
  outputSchema: TimelineEvent,
  examples: ["mb timeline-event get 1", "mb timeline-event get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const event = await client.timelineEvent.get(id);
    renderItem(event, timelineEventView, ctx);
  },
});

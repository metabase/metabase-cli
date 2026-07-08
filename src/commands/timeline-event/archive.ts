import { TimelineEvent, timelineEventView } from "../../domain/timeline";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a timeline event by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Timeline event id", required: true },
  },
  outputSchema: TimelineEvent,
  examples: ["mb timeline-event archive 1", "mb timeline-event archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(TimelineEvent, `/api/timeline-event/${id}`, {
      method: "PUT",
      body: { archived: true },
    });
    renderSummary(
      updated,
      timelineEventView,
      `Archived timeline event ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});

import { TimelineEvent, TimelineEventUpdateInput, timelineEventView } from "../../domain/timeline";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a timeline event by id" },
  details:
    "Patches only the fields you send: `name`, `description`, `timestamp`, `timezone`, `time_matters`, `icon`, `timeline_id` (moves the event to another timeline), `archived`.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Timeline event id", required: true },
  },
  inputSchema: TimelineEventUpdateInput,
  outputSchema: TimelineEvent,
  examples: [
    'mb timeline-event update 1 --body \'{"name":"v2.1 launch"}\'',
    "cat patch.json | mb timeline-event update 1",
    "mb timeline-event update 1 --file patch.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TimelineEventUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(TimelineEvent, `/api/timeline-event/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(
      updated,
      timelineEventView,
      `Updated timeline event ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});

import { TimelineEvent, TimelineEventCreateInput, timelineEventView } from "../../domain/timeline";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a timeline event from JSON" },
  details:
    "The JSON body needs `name`, `timestamp` (ISO 8601), `timezone` (IANA name like UTC or America/New_York), `time_matters` (true when the time of day is significant, false when only the date is), and `timeline_id`; optional fields: `description`, `icon` (star|cake|mail|warning|bell|cloud, default: the timeline's icon).",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: TimelineEventCreateInput,
  outputSchema: TimelineEvent,
  examples: [
    'mb timeline-event create --body \'{"name":"v2 launch","timestamp":"2026-07-01T00:00:00Z","timezone":"UTC","time_matters":false,"timeline_id":1}\'',
    "cat event.json | mb timeline-event create",
    "mb timeline-event create --file event.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TimelineEventCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(TimelineEvent, "/api/timeline-event", {
      method: "POST",
      body,
    });
    renderSummary(
      created,
      timelineEventView,
      `Created timeline event ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

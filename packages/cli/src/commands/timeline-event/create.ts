import { TimelineEvent, TimelineEventCreateInput } from "@metabase/client/domain/timeline";
import { featureAvailability, type FeatureName } from "@metabase/client/version/features";
import { timelineEventView } from "../../output/views/timeline";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const ICONS_FEATURE = "timelineExtendedIcons" satisfies FeatureName;

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a timeline event from JSON" },
  details: `The JSON body needs \`name\`, \`timestamp\` (ISO 8601), \`timezone\` (an IANA name such as \`UTC\` or \`America/New_York\`), \`time_matters\` (\`true\` when the time of day matters, \`false\` when only the date does) and \`timeline_id\`. Optional: \`description\` and \`icon\` (star|cake|mail|warning|bell|cloud, plus mail_at|info|note|event on a server with \`${ICONS_FEATURE}\` (${featureAvailability(ICONS_FEATURE)}); the timeline's icon by default).`,
  requires: ["timelineEvent.create"],
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
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.timelineEvent.create(body);
    renderSummary(
      created,
      timelineEventView,
      `Created timeline event ${created.id} "${created.name}".`,
      ctx,
    );
  },
});

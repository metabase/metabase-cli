import { Timeline, TimelineCreateInput } from "@metabase/client/domain/timeline";
import { featureAvailability, type FeatureName } from "@metabase/client/version/features";
import { timelineView } from "../../output/views/timeline";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const ICONS_FEATURE = "timelineExtendedIcons" satisfies FeatureName;

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a timeline from JSON" },
  details: `The JSON body needs \`name\`; optional fields: \`description\`, \`icon\` (star|cake|mail|warning|bell|cloud, plus mail_at|info|note|event on a server with \`${ICONS_FEATURE}\` (${featureAvailability(ICONS_FEATURE)}); default star), \`collection_id\` (null = root collection), \`default\` (\`true\` marks the collection's default timeline).`,
  requires: ["timeline.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: TimelineCreateInput,
  outputSchema: Timeline,
  examples: [
    'mb timeline create --body \'{"name":"Releases"}\'',
    "cat timeline.json | mb timeline create",
    "mb timeline create --file timeline.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.timeline.create(body);
    renderSummary(created, timelineView, `Created timeline ${created.id} "${created.name}".`, ctx);
  },
});

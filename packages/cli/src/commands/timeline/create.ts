import { Timeline, TimelineCreateInput, timelineView } from "../../domain/timeline";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a timeline from JSON" },
  details:
    "The JSON body needs `name`; optional fields: `description`, `icon` (star|cake|mail|warning|bell|cloud, default star), `collection_id` (null = root collection), `default`.",
  capabilities: { minVersion: 58 },
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
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TimelineCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Timeline, "/api/timeline", {
      method: "POST",
      body,
    });
    renderSummary(created, timelineView, `Created timeline ${created.id} "${created.name}".`, ctx);
  },
});

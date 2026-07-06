import { Timeline, TimelineUpdateInput, timelineView } from "../../domain/timeline";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a timeline by id" },
  details:
    "Patches only the fields you send: `name`, `description`, `icon`, `collection_id`, `default`, `archived`. Changing `archived` cascades to every event on the timeline.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Timeline id", required: true },
  },
  inputSchema: TimelineUpdateInput,
  outputSchema: Timeline,
  examples: [
    'mb timeline update 1 --body \'{"name":"Product releases"}\'',
    "cat patch.json | mb timeline update 1",
    "mb timeline update 1 --file patch.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TimelineUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Timeline, `/api/timeline/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(updated, timelineView, `Updated timeline ${updated.id} "${updated.name}".`, ctx);
  },
});

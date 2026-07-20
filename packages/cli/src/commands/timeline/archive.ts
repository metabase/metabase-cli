import { Timeline, timelineView } from "../../domain/timeline";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "archive",
    description: "Archive (soft-delete) a timeline and all its events by id",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Timeline id", required: true },
  },
  outputSchema: Timeline,
  examples: ["mb timeline archive 1", "mb timeline archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(Timeline, `/api/timeline/${id}`, {
      method: "PUT",
      body: { archived: true },
    });
    renderSummary(updated, timelineView, `Archived timeline ${updated.id} "${updated.name}".`, ctx);
  },
});

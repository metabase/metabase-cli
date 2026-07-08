import { Timeline, timelineView } from "../../domain/timeline";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a timeline by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Timeline id", required: true },
  },
  outputSchema: Timeline,
  examples: ["mb timeline get 1", "mb timeline get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const timeline = await client.requestParsed(Timeline, `/api/timeline/${id}`);
    renderItem(timeline, timelineView, ctx);
  },
});

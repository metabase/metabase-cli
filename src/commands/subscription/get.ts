import { Pulse, pulseView } from "../../domain/pulse";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a dashboard subscription by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Subscription id", required: true },
  },
  outputSchema: Pulse,
  examples: ["mb subscription get 1", "mb subscription get 1 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const subscription = await client.requestParsed(Pulse, `/api/pulse/${id}`);
    renderItem(subscription, pulseView, ctx);
  },
});

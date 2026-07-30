import { pulseView } from "../../output/views/pulse";
import { renderList } from "../../output/render";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { SubscriptionListEnvelope } from "../subscription/list";

export default defineMetabaseCommand({
  meta: { name: "subscriptions", description: "List subscriptions on a dashboard" },
  details:
    "Manage them with `mb subscription create|update|archive`, which take the subscription id printed here.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    archived: {
      type: "boolean",
      description: "Show archived subscriptions instead of active ones",
    },
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: SubscriptionListEnvelope,
  examples: ["mb dashboard subscriptions 10", "mb dashboard subscriptions 10 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data, total } = await client.pulse.list({
      dashboard_id: id,
      archived: args.archived || undefined,
    });
    renderList(windowList(data, ctx.range, total), pulseView, ctx);
  },
});

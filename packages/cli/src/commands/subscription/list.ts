import { PulseCompact } from "@metabase/client/domain/pulse";
import { pulseView } from "../../output/views/pulse";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

export const SubscriptionListEnvelope = listEnvelopeSchema(PulseCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List dashboard subscriptions" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    dashboardId: {
      type: "string",
      description: "Only subscriptions on this dashboard id",
      alias: "dashboard-id",
    },
    archived: {
      type: "boolean",
      description: "Show archived subscriptions instead of active ones",
    },
  },
  outputSchema: SubscriptionListEnvelope,
  examples: [
    "mb subscription list",
    "mb subscription list --dashboard-id 10 --json",
    "mb subscription list --archived --json",
  ],
  async run({ args, ctx, getClient }) {
    const dashboardId = parseOptionalInteger(args.dashboardId, { name: "dashboard-id", min: 1 });
    const client = await getClient();
    const { data, total } = await client.pulse.list({
      dashboard_id: dashboardId ?? undefined,
      archived: args.archived || undefined,
    });
    renderList(windowList(data, ctx.range, total), pulseView, ctx);
  },
});

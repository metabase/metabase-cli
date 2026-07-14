import { z } from "zod";

import { Pulse, PulseCompact, pulseView } from "../../domain/pulse";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

const PulseApiList = z.array(Pulse);

export const SubscriptionListEnvelope = listEnvelopeSchema(PulseCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List dashboard subscriptions" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
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
    const items = await client.requestParsed(PulseApiList, "/api/pulse", {
      query: {
        dashboard_id: dashboardId ?? undefined,
        archived: args.archived || undefined,
      },
    });
    renderList(wrapList(items), pulseView, ctx);
  },
});

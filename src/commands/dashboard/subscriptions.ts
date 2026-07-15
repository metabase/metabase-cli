import { z } from "zod";

import { Pulse, pulseView } from "../../domain/pulse";
import { renderList } from "../../output/render";
import { wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { SubscriptionListEnvelope } from "../subscription/list";

const PulseApiList = z.array(Pulse);

export default defineMetabaseCommand({
  meta: { name: "subscriptions", description: "List subscriptions on a dashboard" },
  details:
    "Manage them with `mb subscription create|update|archive`, which take the subscription id printed here.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
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
    const items = await client.requestParsed(PulseApiList, "/api/pulse", {
      query: { dashboard_id: id, archived: args.archived || undefined },
    });
    renderList(wrapList(items), pulseView, ctx);
  },
});

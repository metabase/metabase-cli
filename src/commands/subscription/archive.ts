import { Pulse, pulseView } from "../../domain/pulse";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { patchSubscription } from "./patch";

export default defineMetabaseCommand({
  meta: {
    name: "archive",
    description: "Archive a dashboard subscription by id, stopping all deliveries",
  },
  details:
    "Archiving also disables every channel on the subscription. Restore it with `mb subscription update <id> --body '{\"archived\":false}'`, then re-enable its channels.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Subscription id", required: true },
  },
  outputSchema: Pulse,
  examples: ["mb subscription archive 1", "mb subscription archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const archived = await patchSubscription(client, id, { archived: true });
    renderSummary(archived, pulseView, `Archived subscription ${archived.id}.`, ctx);
  },
});

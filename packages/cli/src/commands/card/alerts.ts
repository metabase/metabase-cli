import { notificationView } from "../../output/views/notification";
import { renderList } from "../../output/render";
import { windowList } from "../../output/window";
import { AlertListEnvelope } from "../alert/list";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "alerts", description: "List alerts watching a card" },
  details:
    "Manage them with `mb alert create|update|send|archive`, which take the alert id printed here.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    includeInactive: {
      type: "boolean",
      description: "Include archived (inactive) alerts",
      alias: "include-inactive",
    },
    id: { type: "positional", description: "Card id", required: true },
  },
  outputSchema: AlertListEnvelope,
  examples: ["mb card alerts 94", "mb card alerts 94 --include-inactive --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data, total } = await client.notification.list({
      card_id: id,
      include_inactive: args.includeInactive || undefined,
    });
    renderList(windowList(data, ctx.range, total), notificationView, ctx);
  },
});

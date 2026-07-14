import { z } from "zod";

import { CARD_PAYLOAD_TYPE, Notification, notificationView } from "../../domain/notification";
import { renderList } from "../../output/render";
import { wrapList } from "../../output/types";
import { AlertListEnvelope } from "../alert/list";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const NotificationApiList = z.array(Notification);

export default defineMetabaseCommand({
  meta: { name: "alerts", description: "List alerts watching a card" },
  details:
    "Manage them with `mb alert create|update|send|archive`, which take the alert id printed here.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
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
    const items = await client.requestParsed(NotificationApiList, "/api/notification", {
      query: {
        payload_type: CARD_PAYLOAD_TYPE,
        card_id: id,
        include_inactive: args.includeInactive || undefined,
      },
    });
    renderList(wrapList(items), notificationView, ctx);
  },
});

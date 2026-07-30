import { NotificationCompact } from "@metabase/client/domain/notification";
import { notificationView } from "../../output/views/notification";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseOptionalInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";

export const AlertListEnvelope = listEnvelopeSchema(NotificationCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List question alerts" },
  details:
    "Archived (inactive) alerts are hidden unless you pass --include-inactive. System-event notifications, which share the same API, are never listed here.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    cardId: { type: "string", description: "Only alerts watching this card id", alias: "card-id" },
    creatorId: {
      type: "string",
      description: "Only alerts created by this user id",
      alias: "creator-id",
    },
    recipientId: {
      type: "string",
      description: "Only alerts delivered to this user id",
      alias: "recipient-id",
    },
    includeInactive: {
      type: "boolean",
      description: "Include archived (inactive) alerts",
      alias: "include-inactive",
    },
  },
  outputSchema: AlertListEnvelope,
  examples: [
    "mb alert list",
    "mb alert list --card-id 94 --json",
    "mb alert list --include-inactive --json",
  ],
  async run({ args, ctx, getClient }) {
    const cardId = parseOptionalInteger(args.cardId, { name: "card-id", min: 1 });
    const creatorId = parseOptionalInteger(args.creatorId, { name: "creator-id", min: 1 });
    const recipientId = parseOptionalInteger(args.recipientId, { name: "recipient-id", min: 1 });
    const client = await getClient();
    const { data, total } = await client.notification.list({
      card_id: cardId ?? undefined,
      creator_id: creatorId ?? undefined,
      recipient_id: recipientId ?? undefined,
      include_inactive: args.includeInactive || undefined,
    });
    renderList(windowList(data, ctx.range, total), notificationView, ctx);
  },
});

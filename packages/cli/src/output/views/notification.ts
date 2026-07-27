import { z } from "zod";

import {
  type Notification,
  NotificationCardPayload,
  NotificationCompact,
  NotificationHandler,
  type NotificationRecipient,
  NotificationSubscription,
} from "@metabase/client/domain/notification";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

const NullableCardPayload = NotificationCardPayload.nullable();
const NotificationSubscriptionList = z.array(NotificationSubscription);
const NotificationHandlerList = z.array(NotificationHandler);

function formatPayload(value: unknown): string {
  const parsed = NullableCardPayload.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  if (parsed.data === null) {
    return "";
  }
  const { card_id, send_condition, send_once } = parsed.data;
  const once = send_once ? ", once" : "";
  return `${card_id} (${send_condition}${once})`;
}

function formatSubscriptions(value: unknown): string {
  const parsed = NotificationSubscriptionList.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return parsed.data
    .map((subscription) => subscription.cron_schedule ?? subscription.event_name ?? "")
    .filter((label) => label !== "")
    .join("; ");
}

function describeRecipient(recipient: NotificationRecipient): string {
  switch (recipient.type) {
    case "notification-recipient/user": {
      return `user:${recipient.user_id}`;
    }
    case "notification-recipient/group": {
      return `group:${recipient.permissions_group_id}`;
    }
    case "notification-recipient/raw-value": {
      return recipient.details?.value ?? "";
    }
    case "notification-recipient/template": {
      return "template";
    }
  }
}

function describeHandler(handler: NotificationHandler): string {
  const channel = handler.channel_type.replace("channel/", "");
  const recipients = (handler.recipients ?? []).map(describeRecipient).join(", ");
  return recipients === "" ? channel : `${channel} → ${recipients}`;
}

function formatHandlers(value: unknown): string {
  const parsed = NotificationHandlerList.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return parsed.data.map(describeHandler).join("; ");
}

export const notificationView: ResourceView<Notification> = {
  compactPick: NotificationCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "payload", label: "Card", format: formatPayload },
    { key: "subscriptions", label: "Schedule", format: formatSubscriptions },
    { key: "handlers", label: "Delivery", format: formatHandlers },
    { key: "active", label: "Active" },
  ],
};

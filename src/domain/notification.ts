import { z } from "zod";

import { CronUiDisplayType } from "./cron";
import type { ResourceView } from "./view";

export const NotificationPayloadType = z.enum([
  "notification/card",
  "notification/dashboard",
  "notification/system-event",
  "notification/testing",
]);
export type NotificationPayloadType = z.infer<typeof NotificationPayloadType>;

// The payload type of a question alert. /api/notification also serves Metabase's internal
// system-event notifications, so every `mb alert` request scopes itself to this one.
export const CARD_PAYLOAD_TYPE: NotificationPayloadType = "notification/card";

export const NotificationSendCondition = z.enum(["has_result", "goal_above", "goal_below"]);
export type NotificationSendCondition = z.infer<typeof NotificationSendCondition>;

export const NotificationChannelType = z.enum(["channel/email", "channel/slack", "channel/http"]);
export type NotificationChannelType = z.infer<typeof NotificationChannelType>;

export const NotificationRecipientType = z.enum([
  "notification-recipient/user",
  "notification-recipient/group",
  "notification-recipient/raw-value",
  "notification-recipient/template",
]);
export type NotificationRecipientType = z.infer<typeof NotificationRecipientType>;

export const NotificationSubscriptionType = z.enum([
  "notification-subscription/cron",
  "notification-subscription/system-event",
]);
export type NotificationSubscriptionType = z.infer<typeof NotificationSubscriptionType>;

// `value` carries the email address (email channel) or the channel name (Slack channel).
export const NotificationRecipientDetails = z
  .object({
    value: z.string().optional(),
    channel_id: z.string().nullable().optional(),
  })
  .loose();
export type NotificationRecipientDetails = z.infer<typeof NotificationRecipientDetails>;

const NotificationRecipientDetailsCompact = NotificationRecipientDetails.pick({
  value: true,
  channel_id: true,
}).strip();

export const NotificationRecipient = z
  .object({
    id: z.number().int().optional(),
    type: NotificationRecipientType,
    user_id: z.number().int().nullable().optional(),
    permissions_group_id: z.number().int().nullable().optional(),
    details: NotificationRecipientDetails.nullable().optional(),
  })
  .loose();
export type NotificationRecipient = z.infer<typeof NotificationRecipient>;

export const NotificationRecipientCompact = NotificationRecipient.pick({
  type: true,
  user_id: true,
  permissions_group_id: true,
})
  .strip()
  .extend({ details: NotificationRecipientDetailsCompact.nullable().optional() });
export type NotificationRecipientCompact = z.infer<typeof NotificationRecipientCompact>;

export const NotificationHandler = z
  .object({
    id: z.number().int().optional(),
    channel_type: NotificationChannelType,
    channel_id: z.number().int().nullable().optional(),
    template_id: z.number().int().nullable().optional(),
    active: z.boolean().optional(),
    recipients: z.array(NotificationRecipient).optional(),
  })
  .loose();
export type NotificationHandler = z.infer<typeof NotificationHandler>;

export const NotificationHandlerCompact = NotificationHandler.pick({
  channel_type: true,
  channel_id: true,
})
  .strip()
  .extend({ recipients: z.array(NotificationRecipientCompact).optional() });
export type NotificationHandlerCompact = z.infer<typeof NotificationHandlerCompact>;

export const NotificationSubscription = z
  .object({
    id: z.number().int().optional(),
    type: NotificationSubscriptionType,
    cron_schedule: z.string().nullable().optional(),
    event_name: z.string().nullable().optional(),
    ui_display_type: CronUiDisplayType.nullable().optional(),
  })
  .loose();
export type NotificationSubscription = z.infer<typeof NotificationSubscription>;

export const NotificationSubscriptionCompact = NotificationSubscription.pick({
  type: true,
  cron_schedule: true,
}).strip();
export type NotificationSubscriptionCompact = z.infer<typeof NotificationSubscriptionCompact>;

export const NotificationCardPayload = z
  .object({
    id: z.number().int().optional(),
    card_id: z.number().int(),
    send_condition: NotificationSendCondition,
    send_once: z.boolean(),
  })
  .loose();
export type NotificationCardPayload = z.infer<typeof NotificationCardPayload>;

export const NotificationCardPayloadCompact = NotificationCardPayload.pick({
  card_id: true,
  send_condition: true,
  send_once: true,
}).strip();
export type NotificationCardPayloadCompact = z.infer<typeof NotificationCardPayloadCompact>;

// `payload` is null for system-event notifications, which share the /api/notification table with
// card alerts.
export const Notification = z
  .object({
    id: z.number().int(),
    payload_type: NotificationPayloadType,
    payload_id: z.number().int().nullable(),
    payload: NotificationCardPayload.nullable(),
    active: z.boolean(),
    creator_id: z.number().int().nullable(),
    subscriptions: z.array(NotificationSubscription),
    handlers: z.array(NotificationHandler),
  })
  .loose();
export type Notification = z.infer<typeof Notification>;

export const NotificationCompact = Notification.pick({
  id: true,
  payload_type: true,
  active: true,
  creator_id: true,
})
  .strip()
  .extend({
    payload: NotificationCardPayloadCompact.nullable(),
    subscriptions: z.array(NotificationSubscriptionCompact),
    handlers: z.array(NotificationHandlerCompact),
  });
export type NotificationCompact = z.infer<typeof NotificationCompact>;

const NullableCardPayload = NotificationCardPayload.nullable();
const NotificationSubscriptionList = z.array(NotificationSubscription);
const NotificationHandlerList = z.array(NotificationHandler);

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

function formatPayload(value: unknown): string {
  const parsed = NullableCardPayload.safeParse(value);
  if (!parsed.success || parsed.data === null) {
    return "";
  }
  const { card_id, send_condition, send_once } = parsed.data;
  const once = send_once ? ", once" : "";
  return `${card_id} (${send_condition}${once})`;
}

function formatSubscriptions(value: unknown): string {
  const parsed = NotificationSubscriptionList.safeParse(value);
  if (!parsed.success) {
    return "";
  }
  return parsed.data
    .map((subscription) => subscription.cron_schedule ?? subscription.event_name ?? "")
    .filter((label) => label !== "")
    .join("; ");
}

function formatHandlers(value: unknown): string {
  const parsed = NotificationHandlerList.safeParse(value);
  if (!parsed.success) {
    return "";
  }
  return parsed.data.map(describeHandler).join("; ");
}

function describeHandler(handler: NotificationHandler): string {
  const channel = handler.channel_type.replace("channel/", "");
  const recipients = (handler.recipients ?? []).map(describeRecipient).join(", ");
  return recipients === "" ? channel : `${channel} → ${recipients}`;
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

const NotificationRecipientInput = z
  .object({
    type: NotificationRecipientType,
    user_id: z.number().int().positive().optional(),
    permissions_group_id: z.number().int().positive().optional(),
    details: NotificationRecipientDetails.optional(),
  })
  .loose();

const NotificationHandlerInput = z
  .object({
    channel_type: NotificationChannelType,
    channel_id: z.number().int().positive().nullable().optional(),
    active: z.boolean().optional(),
    recipients: z.array(NotificationRecipientInput).optional(),
  })
  .loose();

const NotificationSubscriptionInput = z
  .object({
    type: NotificationSubscriptionType.default("notification-subscription/cron"),
    cron_schedule: z.string().min(1),
  })
  .loose();

const NotificationCardPayloadInput = z
  .object({
    card_id: z.number().int().positive(),
    send_condition: NotificationSendCondition.optional(),
    send_once: z.boolean().optional(),
  })
  .loose();

export const NotificationCreateInput = z
  .object({
    payload_type: NotificationPayloadType.default(CARD_PAYLOAD_TYPE),
    payload: NotificationCardPayloadInput,
    subscriptions: z.array(NotificationSubscriptionInput).min(1),
    handlers: z.array(NotificationHandlerInput).min(1),
    active: z.boolean().optional(),
  })
  .loose();
export type NotificationCreateInput = z.infer<typeof NotificationCreateInput>;

export const NotificationCardPayloadPatch = NotificationCardPayloadInput.partial();
export type NotificationCardPayloadPatch = z.infer<typeof NotificationCardPayloadPatch>;

export const NotificationUpdateInput = z
  .object({
    payload: NotificationCardPayloadPatch.optional(),
    subscriptions: z.array(NotificationSubscriptionInput).min(1).optional(),
    handlers: z.array(NotificationHandlerInput).min(1).optional(),
    active: z.boolean().optional(),
  })
  .loose();
export type NotificationUpdateInput = z.infer<typeof NotificationUpdateInput>;

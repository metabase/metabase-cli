import { z } from "zod";

import { Parameter } from "./parameter";
import type { ResourceView } from "./view";

export const PulseChannelType = z.enum(["email", "slack", "http"]);
export type PulseChannelType = z.infer<typeof PulseChannelType>;

export const PulseScheduleType = z.enum(["hourly", "daily", "weekly", "monthly"]);
export type PulseScheduleType = z.infer<typeof PulseScheduleType>;

export const PulseScheduleDay = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type PulseScheduleDay = z.infer<typeof PulseScheduleDay>;

export const PulseScheduleFrame = z.enum(["first", "mid", "last"]);
export type PulseScheduleFrame = z.infer<typeof PulseScheduleFrame>;

export const PulseChannelDetails = z.object({ channel: z.string().optional() }).loose();
export type PulseChannelDetails = z.infer<typeof PulseChannelDetails>;

// A Metabase user recipient carries `id` plus profile fields; a plain external address carries
// only `email`.
export const PulseRecipient = z
  .object({
    id: z.number().int().nullable().optional(),
    email: z.string(),
  })
  .loose();
export type PulseRecipient = z.infer<typeof PulseRecipient>;

export const PulseRecipientCompact = PulseRecipient.pick({ id: true, email: true }).strip();
export type PulseRecipientCompact = z.infer<typeof PulseRecipientCompact>;

export const PulseChannel = z
  .object({
    id: z.number().int().optional(),
    channel_type: PulseChannelType,
    channel_id: z.number().int().nullable().optional(),
    enabled: z.boolean(),
    schedule_type: PulseScheduleType,
    schedule_hour: z.number().int().nullable(),
    schedule_day: PulseScheduleDay.nullable(),
    schedule_frame: PulseScheduleFrame.nullable(),
    details: PulseChannelDetails.optional(),
    recipients: z.array(PulseRecipient),
  })
  .loose();
export type PulseChannel = z.infer<typeof PulseChannel>;

export const PulseChannelCompact = PulseChannel.pick({
  channel_type: true,
  enabled: true,
  schedule_type: true,
  schedule_hour: true,
  schedule_day: true,
  schedule_frame: true,
  details: true,
})
  .strip()
  .extend({ recipients: z.array(PulseRecipientCompact) });
export type PulseChannelCompact = z.infer<typeof PulseChannelCompact>;

export const PulseCard = z
  .object({
    id: z.number().int(),
    name: z.string(),
    dashboard_card_id: z.number().int().nullable(),
    include_csv: z.boolean(),
    include_xls: z.boolean(),
  })
  .loose();
export type PulseCard = z.infer<typeof PulseCard>;

export const PulseCardCompact = PulseCard.pick({
  id: true,
  name: true,
  dashboard_card_id: true,
  include_csv: true,
  include_xls: true,
}).strip();
export type PulseCardCompact = z.infer<typeof PulseCardCompact>;

export const Pulse = z
  .object({
    id: z.number().int(),
    name: z.string().nullable(),
    creator_id: z.number().int(),
    dashboard_id: z.number().int().nullable(),
    collection_id: z.number().int().nullable(),
    archived: z.boolean(),
    skip_if_empty: z.boolean(),
    parameters: z.array(Parameter),
    cards: z.array(PulseCard),
    channels: z.array(PulseChannel),
  })
  .loose();
export type Pulse = z.infer<typeof Pulse>;

export const PulseCompact = Pulse.pick({
  id: true,
  name: true,
  dashboard_id: true,
  collection_id: true,
  archived: true,
  skip_if_empty: true,
})
  .strip()
  .extend({
    cards: z.array(PulseCardCompact),
    channels: z.array(PulseChannelCompact),
  });
export type PulseCompact = z.infer<typeof PulseCompact>;

const PulseChannelList = z.array(PulseChannel);

export const pulseView: ResourceView<Pulse> = {
  compactPick: PulseCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "dashboard_id", label: "Dashboard" },
    { key: "channels", label: "Delivery", format: formatChannels },
    { key: "archived", label: "Archived" },
  ],
};

function formatChannels(value: unknown): string {
  const parsed = PulseChannelList.safeParse(value);
  if (!parsed.success) {
    return "";
  }
  return parsed.data.map(describeChannel).join("; ");
}

function describeChannel(channel: PulseChannel): string {
  const parts: string[] = [channel.channel_type, describeSchedule(channel)];
  const audience = describeAudience(channel);
  if (audience !== null) {
    parts.push(`→ ${audience}`);
  }
  if (!channel.enabled) {
    parts.push("(disabled)");
  }
  return parts.join(" ");
}

function describeSchedule(channel: PulseChannel): string {
  const parts: string[] = [channel.schedule_type];
  if (channel.schedule_frame !== null) {
    parts.push(channel.schedule_frame);
  }
  if (channel.schedule_day !== null) {
    parts.push(channel.schedule_day);
  }
  if (channel.schedule_hour !== null) {
    parts.push(`${channel.schedule_hour}:00`);
  }
  return parts.join(" ");
}

function describeAudience(channel: PulseChannel): string | null {
  if (channel.recipients.length > 0) {
    return channel.recipients.map((recipient) => recipient.email).join(", ");
  }
  const slackChannel = channel.details?.channel;
  return slackChannel === undefined ? null : slackChannel;
}

const PulseRecipientInput = z.union([
  z.object({ id: z.number().int().positive() }).loose(),
  z.object({ email: z.string().min(1) }).loose(),
]);

const PulseCardInput = z
  .object({
    id: z.number().int().positive(),
    include_csv: z.boolean(),
    include_xls: z.boolean(),
    dashboard_card_id: z.number().int().positive().nullable().optional(),
    format_rows: z.boolean().optional(),
    pivot_results: z.boolean().optional(),
  })
  .loose();

// The server asserts `boolean? enabled` on every channel, so the CLI fills it in rather than
// letting an omission surface as a 500-shaped assertion failure.
const PulseChannelInput = z
  .object({
    channel_type: PulseChannelType,
    enabled: z.boolean().default(true),
    schedule_type: PulseScheduleType,
    schedule_hour: z.number().int().min(0).max(23).nullable().optional(),
    schedule_day: PulseScheduleDay.nullable().optional(),
    schedule_frame: PulseScheduleFrame.nullable().optional(),
    channel_id: z.number().int().positive().nullable().optional(),
    details: PulseChannelDetails.optional(),
    recipients: z.array(PulseRecipientInput).optional(),
  })
  .loose();

export const PulseCreateInput = z
  .object({
    name: z.string().min(1),
    dashboard_id: z.number().int().positive(),
    cards: z.array(PulseCardInput).min(1),
    channels: z.array(PulseChannelInput).min(1),
    skip_if_empty: z.boolean().optional(),
    parameters: z.array(Parameter).optional(),
  })
  .loose();
export type PulseCreateInput = z.infer<typeof PulseCreateInput>;

export const PulseUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    cards: z.array(PulseCardInput).min(1).optional(),
    channels: z.array(PulseChannelInput).min(1).optional(),
    skip_if_empty: z.boolean().optional(),
    archived: z.boolean().optional(),
    parameters: z.array(Parameter).optional(),
  })
  .loose();
export type PulseUpdateInput = z.infer<typeof PulseUpdateInput>;

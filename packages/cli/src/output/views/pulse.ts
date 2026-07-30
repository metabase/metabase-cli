import { z } from "zod";

import { type Pulse, PulseChannel, PulseCompact } from "@metabase/client/domain/pulse";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

const PulseChannelList = z.array(PulseChannel);

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

function formatChannels(value: unknown): string {
  const parsed = PulseChannelList.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  return parsed.data.map(describeChannel).join("; ");
}

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

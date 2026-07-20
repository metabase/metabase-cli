import { z } from "zod";

import type { ResourceView } from "./view";

export const TimelineIcon = z.enum(["star", "cake", "mail", "warning", "bell", "cloud"]);
export type TimelineIcon = z.infer<typeof TimelineIcon>;

export const TimelineEvent = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    timestamp: z.string(),
    timezone: z.string(),
    time_matters: z.boolean(),
    icon: TimelineIcon,
    timeline_id: z.number().int(),
    archived: z.boolean(),
    creator_id: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const TimelineEventCompact = TimelineEvent.pick({
  id: true,
  name: true,
  description: true,
  timestamp: true,
  icon: true,
  timeline_id: true,
  archived: true,
}).strip();
export type TimelineEventCompact = z.infer<typeof TimelineEventCompact>;

export const timelineEventView: ResourceView<TimelineEvent> = {
  compactPick: TimelineEventCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "timestamp", label: "Timestamp" },
    { key: "icon", label: "Icon" },
    { key: "timeline_id", label: "Timeline" },
    { key: "archived", label: "Archived" },
  ],
};

export const Timeline = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    icon: TimelineIcon,
    collection_id: z.number().int().nullable(),
    archived: z.boolean(),
    default: z.boolean(),
    creator_id: z.number().int(),
    entity_id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    events: z.array(TimelineEvent).optional(),
  })
  .loose();
export type Timeline = z.infer<typeof Timeline>;

export const TimelineCompact = Timeline.pick({
  id: true,
  name: true,
  description: true,
  icon: true,
  collection_id: true,
  default: true,
  archived: true,
}).strip();
export type TimelineCompact = z.infer<typeof TimelineCompact>;

export const timelineView: ResourceView<Timeline> = {
  compactPick: TimelineCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "icon", label: "Icon" },
    { key: "collection_id", label: "Collection" },
    { key: "default", label: "Default" },
    { key: "archived", label: "Archived" },
  ],
};

export const TimelineCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    icon: TimelineIcon.nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    default: z.boolean().nullable().optional(),
  })
  .loose();
export type TimelineCreateInput = z.infer<typeof TimelineCreateInput>;

export const TimelineUpdateInput = z
  .object({
    name: z.string().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    icon: TimelineIcon.nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    default: z.boolean().nullable().optional(),
    archived: z.boolean().nullable().optional(),
  })
  .loose();
export type TimelineUpdateInput = z.infer<typeof TimelineUpdateInput>;

export const TimelineEventCreateInput = z
  .object({
    name: z.string().min(1),
    timestamp: z.string().min(1),
    timezone: z.string().min(1),
    // The API schema marks time_matters optional, but the column is NOT NULL with no
    // default — omitting it is a server 500, so the CLI contract requires it.
    time_matters: z.boolean(),
    timeline_id: z.number().int().positive(),
    description: z.string().nullable().optional(),
    icon: TimelineIcon.nullable().optional(),
    archived: z.boolean().nullable().optional(),
  })
  .loose();
export type TimelineEventCreateInput = z.infer<typeof TimelineEventCreateInput>;

export const TimelineEventUpdateInput = z
  .object({
    name: z.string().min(1).nullable().optional(),
    description: z.string().nullable().optional(),
    timestamp: z.string().min(1).nullable().optional(),
    timezone: z.string().min(1).nullable().optional(),
    time_matters: z.boolean().nullable().optional(),
    icon: TimelineIcon.nullable().optional(),
    timeline_id: z.number().int().positive().nullable().optional(),
    archived: z.boolean().nullable().optional(),
  })
  .loose();
export type TimelineEventUpdateInput = z.infer<typeof TimelineEventUpdateInput>;

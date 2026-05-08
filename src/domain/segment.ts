import { z } from "zod";

import type { ResourceView } from "./view";

export const Segment = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    archived: z.boolean(),
    table_id: z.number().int(),
    definition: z.unknown(),
    creator_id: z.number().int(),
    entity_id: z.string().nullable(),
    show_in_getting_started: z.boolean().nullable(),
    caveats: z.string().nullable(),
    points_of_interest: z.string().nullable(),
    definition_description: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type Segment = z.infer<typeof Segment>;

export const SegmentCompact = Segment.pick({
  id: true,
  name: true,
  description: true,
  archived: true,
  table_id: true,
}).strip();
export type SegmentCompact = z.infer<typeof SegmentCompact>;

export const segmentView: ResourceView<Segment> = {
  compactPick: SegmentCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "table_id", label: "Table" },
    { key: "archived", label: "Archived" },
  ],
};

export const SegmentCreateInput = z
  .object({
    name: z.string().min(1),
    table_id: z.number().int().positive(),
    definition: z.record(z.string(), z.unknown()),
    description: z.string().nullable().optional(),
  })
  .loose();
export type SegmentCreateInput = z.infer<typeof SegmentCreateInput>;

export const SegmentUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    definition: z.record(z.string(), z.unknown()).optional(),
    revision_message: z.string().min(1),
    archived: z.boolean().optional(),
    description: z.string().nullable().optional(),
    caveats: z.string().nullable().optional(),
    points_of_interest: z.string().nullable().optional(),
    show_in_getting_started: z.boolean().optional(),
  })
  .loose();
export type SegmentUpdateInput = z.infer<typeof SegmentUpdateInput>;

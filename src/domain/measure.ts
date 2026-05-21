import { z } from "zod";

import type { ResourceView } from "./view";

export const Measure = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    archived: z.boolean(),
    table_id: z.number().int(),
    definition: z.unknown(),
    creator_id: z.number().int(),
    entity_id: z.string().nullable(),
    dimensions: z.array(z.unknown()).nullish(),
    dimension_mappings: z.array(z.unknown()).nullish(),
    definition_description: z.string().nullable().optional(),
    result_column_name: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type Measure = z.infer<typeof Measure>;

export const MeasureCompact = Measure.pick({
  id: true,
  name: true,
  description: true,
  archived: true,
  table_id: true,
}).strip();
export type MeasureCompact = z.infer<typeof MeasureCompact>;

export const measureView: ResourceView<Measure> = {
  compactPick: MeasureCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "table_id", label: "Table" },
    { key: "archived", label: "Archived" },
  ],
};

export const MeasureCreateInput = z
  .object({
    name: z.string().min(1),
    table_id: z.number().int().positive(),
    definition: z.record(z.string(), z.unknown()),
    description: z.string().nullable().optional(),
  })
  .loose();
export type MeasureCreateInput = z.infer<typeof MeasureCreateInput>;

export const MeasureUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    definition: z.record(z.string(), z.unknown()).optional(),
    revision_message: z.string().min(1),
    archived: z.boolean().optional(),
    description: z.string().nullable().optional(),
  })
  .loose();
export type MeasureUpdateInput = z.infer<typeof MeasureUpdateInput>;

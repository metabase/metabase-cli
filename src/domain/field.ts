import { z } from "zod";

import type { ResourceView } from "./view";

const FieldVisibilityType = z.enum(["details-only", "hidden", "normal", "retired", "sensitive"]);

const FieldValuesType = z.enum(["list", "search", "none", "auto-list"]);

export const Field = z
  .object({
    id: z.number().int(),
    table_id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    database_type: z.string().nullable().optional(),
    base_type: z.string(),
    semantic_type: z.string().nullable(),
    fk_target_field_id: z.number().int().nullable(),
    has_field_values: FieldValuesType.nullable().optional(),
    visibility_type: FieldVisibilityType.nullable().optional(),
    active: z.boolean().optional(),
    position: z.number().int().optional(),
  })
  .loose();
export type Field = z.infer<typeof Field>;

export const FieldCompact = Field.pick({
  id: true,
  name: true,
  display_name: true,
  description: true,
  table_id: true,
  base_type: true,
  semantic_type: true,
  fk_target_field_id: true,
}).strip();
export type FieldCompact = z.infer<typeof FieldCompact>;

export const fieldView: ResourceView<Field> = {
  compactPick: FieldCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "display_name", label: "Display Name" },
    { key: "base_type", label: "Base Type" },
    { key: "semantic_type", label: "Semantic Type" },
    { key: "fk_target_field_id", label: "FK Target" },
    { key: "description", label: "Description" },
  ],
};

export const FieldUpdateInput = z
  .object({
    display_name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    caveats: z.string().nullable().optional(),
    points_of_interest: z.string().nullable().optional(),
    semantic_type: z.string().nullable().optional(),
    coercion_strategy: z.string().nullable().optional(),
    fk_target_field_id: z.number().int().positive().nullable().optional(),
    visibility_type: FieldVisibilityType.optional(),
    has_field_values: FieldValuesType.optional(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    nfc_path: z.array(z.string()).nullable().optional(),
    json_unfolding: z.boolean().nullable().optional(),
  })
  .loose();
export type FieldUpdateInput = z.infer<typeof FieldUpdateInput>;

export const FieldValues = z
  .object({
    values: z.array(z.array(z.unknown())),
    field_id: z.number().int().optional(),
    has_more_values: z.boolean().optional(),
    has_field_values: FieldValuesType.optional(),
  })
  .loose();
export type FieldValues = z.infer<typeof FieldValues>;

export const FieldValuesCompact = FieldValues.pick({
  values: true,
  field_id: true,
  has_more_values: true,
}).strip();
export type FieldValuesCompact = z.infer<typeof FieldValuesCompact>;

export const fieldValuesView: ResourceView<FieldValues> = {
  compactPick: FieldValuesCompact,
  tableColumns: [
    { key: "field_id", label: "Field" },
    { key: "has_more_values", label: "Has More" },
    { key: "values", label: "Values" },
  ],
};

export const FieldSummaryRaw = z.tuple([
  z.tuple([z.literal("count"), z.number().int()]),
  z.tuple([z.literal("distincts"), z.number().int()]),
]);
export type FieldSummaryRaw = z.infer<typeof FieldSummaryRaw>;

export const FieldSummary = z.object({
  field_id: z.number().int(),
  count: z.number().int(),
  distincts: z.number().int(),
});
export type FieldSummary = z.infer<typeof FieldSummary>;

export const fieldSummaryView: ResourceView<FieldSummary> = {
  compactPick: FieldSummary,
  tableColumns: [
    { key: "field_id", label: "Field" },
    { key: "count", label: "Count" },
    { key: "distincts", label: "Distinct" },
  ],
};

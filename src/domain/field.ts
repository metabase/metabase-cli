import { z } from "zod";

import type { ResourceView } from "./view";

const FieldVisibilityType = z.enum([
  "details-only",
  "hidden",
  "normal",
  "retired",
  "sensitive",
]);

const FieldValuesType = z.enum(["list", "search", "none"]);

export const Field = z
  .object({
    id: z.number().int(),
    table_id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    database_type: z.string(),
    base_type: z.string(),
    semantic_type: z.string().nullable(),
    fk_target_field_id: z.number().int().nullable(),
    has_field_values: FieldValuesType,
    visibility_type: FieldVisibilityType,
    active: z.boolean(),
    position: z.number().int(),
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

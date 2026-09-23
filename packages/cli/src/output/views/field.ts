import { z } from "zod";

import {
  type Field,
  FieldCompact,
  FieldSummary,
  type FieldValues,
  FieldValuesCompact,
} from "@metabase/client/domain/field";

import type { ResourceView } from "../view";

function formatTypeTag(value: unknown): string {
  return typeof value === "string" ? value.replace(/^type\//, "") : "";
}

function formatFkTarget(value: unknown): string {
  return typeof value === "number" ? `field ${value}` : "";
}

export const fieldView: ResourceView<Field> = {
  compactPick: FieldCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "display_name", label: "Display Name" },
    { key: "base_type", label: "Base Type", format: formatTypeTag },
    { key: "semantic_type", label: "Semantic Type", format: formatTypeTag },
    { key: "fk_target_field_id", label: "FK Target", format: formatFkTarget },
    { key: "description", label: "Description" },
  ],
};

// A dropdown field's cached distinct values, raw, with any remapped label dropped: `null` on a
// field Metabase keeps no dropdown list for.
export const FieldWithValuesCompact = FieldCompact.extend({
  values: z.array(z.unknown()).nullable(),
});
export type FieldWithValues = Field & Pick<z.infer<typeof FieldWithValuesCompact>, "values">;

export const fieldWithValuesView: ResourceView<FieldWithValues> = {
  compactPick: FieldWithValuesCompact,
  tableColumns: [...fieldView.tableColumns, { key: "values", label: "Values" }],
};

export const fieldValuesView: ResourceView<FieldValues> = {
  compactPick: FieldValuesCompact,
  tableColumns: [
    { key: "field_id", label: "Field" },
    { key: "has_more_values", label: "Has More" },
    { key: "values", label: "Values" },
  ],
};

export const fieldSummaryView: ResourceView<FieldSummary> = {
  compactPick: FieldSummary,
  tableColumns: [
    { key: "field_id", label: "Field" },
    { key: "count", label: "Count" },
    { key: "distincts", label: "Distinct" },
  ],
};

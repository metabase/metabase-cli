import { z } from "zod";

import {
  type Field,
  FieldCompact,
  FieldSummary,
  type FieldValues,
  FieldValuesCompact,
  type FieldWithDataSensitivity,
  FieldWithDataSensitivityCompact,
} from "@metabase/client/domain/field";

import type { ColumnDef, ResourceView } from "../view";

function formatTypeTag(value: unknown): string {
  return typeof value === "string" ? value.replace(/^type\//, "") : "";
}

function formatFkTarget(value: unknown): string {
  return typeof value === "number" ? `field ${value}` : "";
}

const FIELD_COLUMNS: ColumnDef<Field>[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "display_name", label: "Display Name" },
  { key: "base_type", label: "Base Type", format: formatTypeTag },
  { key: "semantic_type", label: "Semantic Type", format: formatTypeTag },
  { key: "fk_target_field_id", label: "FK Target", format: formatFkTarget },
  { key: "description", label: "Description" },
];

export const fieldView: ResourceView<Field> = {
  compactPick: FieldCompact,
  tableColumns: FIELD_COLUMNS,
};

export const fieldWithDataSensitivityView: ResourceView<FieldWithDataSensitivity> = {
  compactPick: FieldWithDataSensitivityCompact,
  tableColumns: [...FIELD_COLUMNS, { key: "data_sensitivity", label: "Sensitivity" }],
};

// The wire answers a search row as `[value, label]`, or `[value]` when the search field is the
// field itself and carries no custom display values. `label` is then `null`: the server answered
// the value once.
export const FieldValueLabel = z.object({ value: z.unknown(), label: z.unknown() });
export type FieldValueLabel = z.infer<typeof FieldValueLabel>;

export function toValueLabel(row: readonly unknown[]): FieldValueLabel {
  const [value, label = null] = row;
  return { value, label };
}

const VALUE_LABEL_COLUMNS: ColumnDef<FieldValueLabel>[] = [
  { key: "value", label: "Value" },
  { key: "label", label: "Label" },
];

export const fieldValueLabelView: ResourceView<FieldValueLabel> = {
  compactPick: FieldValueLabel,
  tableColumns: VALUE_LABEL_COLUMNS,
};

const FieldRemappingMatch = z.object({ found: z.literal(true), ...FieldValueLabel.shape });
export type FieldRemappingMatch = z.infer<typeof FieldRemappingMatch>;

const FieldRemappingMiss = z.object({ found: z.literal(false) });
export type FieldRemappingMiss = z.infer<typeof FieldRemappingMiss>;

export const FieldRemappingResult = z.discriminatedUnion("found", [
  FieldRemappingMatch,
  FieldRemappingMiss,
]);

export const fieldRemappingMatchView: ResourceView<FieldRemappingMatch> = {
  compactPick: FieldRemappingMatch,
  tableColumns: VALUE_LABEL_COLUMNS,
};

export const fieldRemappingMissView: ResourceView<FieldRemappingMiss> = {
  compactPick: FieldRemappingMiss,
  tableColumns: [{ key: "found", label: "Found" }],
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

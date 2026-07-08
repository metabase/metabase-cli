import { z } from "zod";

import type { ResourceView } from "./view";

export const ParameterType = z.enum([
  "number",
  "text",
  "date",
  "boolean",
  "date/single",
  "id",
  "category",
  "location/city",
  "location/state",
  "location/zip_code",
  "location/country",
  "date/range",
  "date/month-year",
  "date/quarter-year",
  "date/relative",
  "date/all-options",
  "temporal-unit",
  "number/!=",
  "number/<=",
  "number/=",
  "number/>=",
  "number/between",
  "string/!=",
  "string/=",
  "string/contains",
  "string/does-not-contain",
  "string/ends-with",
  "string/starts-with",
  "boolean/=",
]);
export type ParameterType = z.infer<typeof ParameterType>;

export const TemporalUnit = z.enum([
  "millisecond",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
  "second-of-minute",
  "minute-of-hour",
  "hour-of-day",
  "day-of-week",
  "day-of-month",
  "day-of-year",
  "week-of-year",
  "month-of-year",
  "quarter-of-year",
  "year-of-era",
  "default",
]);
export type TemporalUnit = z.infer<typeof TemporalUnit>;

export const ValuesSourceType = z.enum(["static-list", "card"]);
export type ValuesSourceType = z.infer<typeof ValuesSourceType>;

export const ValuesQueryType = z.enum(["list", "search", "none"]);
export type ValuesQueryType = z.infer<typeof ValuesQueryType>;

const TemplateTagRef = z.tuple([
  z.literal("template-tag"),
  z.union([z.string(), z.object({ id: z.string() }).loose()]),
]);

// Legacy MBQL field clause (`["field", id|name, opts]`) or one of its MBQL-3 aliases
// (`field-id`, `fk->`, …). The wrapping tag is what an agent gets wrong; the inner
// shape is left permissive so reads of older stored targets don't reject.
const FieldRefLike = z.tuple([z.string()]).rest(z.unknown());

const DimensionTarget = z
  .tuple([z.literal("dimension"), z.union([TemplateTagRef, FieldRefLike])])
  .rest(z.unknown());

const VariableTarget = z.tuple([z.literal("variable"), z.union([TemplateTagRef, FieldRefLike])]);

const TextTagTarget = z.tuple([z.literal("text-tag"), z.string()]);

export const ParameterTarget = z.union([
  DimensionTarget,
  VariableTarget,
  TextTagTarget,
  z.number().int(),
  FieldRefLike,
]);
export type ParameterTarget = z.infer<typeof ParameterTarget>;

export const ValuesSourceConfig = z
  .object({
    values: z.array(z.unknown()).optional(),
    card_id: z.number().int().optional(),
    value_field: FieldRefLike.optional(),
    label_field: FieldRefLike.optional(),
  })
  .loose();
export type ValuesSourceConfig = z.infer<typeof ValuesSourceConfig>;

export const Parameter = z
  .object({
    id: z.string(),
    type: ParameterType,
    name: z.string().optional(),
    slug: z.string().optional(),
    sectionId: z.string().optional(),
    default: z.unknown().optional(),
    required: z.boolean().optional(),
    filteringParameters: z.array(z.string()).nullable().optional(),
    target: ParameterTarget.optional(),
    temporal_units: z.array(TemporalUnit).nullable().optional(),
    values_query_type: ValuesQueryType.nullable().optional(),
    values_source_type: ValuesSourceType.nullable().optional(),
    values_source_config: ValuesSourceConfig.nullable().optional(),
  })
  .loose();
export type Parameter = z.infer<typeof Parameter>;

export const ParameterMapping = z
  .object({
    parameter_id: z.string(),
    target: ParameterTarget,
    card_id: z.number().int().nullable().optional(),
  })
  .loose();
export type ParameterMapping = z.infer<typeof ParameterMapping>;

export const ParameterValues = z
  .object({
    values: z.array(z.array(z.unknown())),
    has_more_values: z.boolean(),
  })
  .loose();
export type ParameterValues = z.infer<typeof ParameterValues>;

export const ParameterValuesCompact = ParameterValues.pick({
  values: true,
  has_more_values: true,
}).strip();
export type ParameterValuesCompact = z.infer<typeof ParameterValuesCompact>;

export const parameterValuesView: ResourceView<ParameterValues> = {
  compactPick: ParameterValuesCompact,
  tableColumns: [{ key: "has_more_values", label: "More available" }],
};

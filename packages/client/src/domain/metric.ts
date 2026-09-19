import { z } from "zod";

import { FieldBaseType, FieldSemanticType } from "./field";
import { TemporalUnit } from "./parameter";

// Every clause in a metric definition is `[tag, options, ...args]`; the options map is what the
// server normalizes, and the only key the definition clauses read from it is `lib/uuid`.
const ClauseOptions = z.object({}).loose();
type ClauseOptions = z.infer<typeof ClauseOptions>;

export const MetricLeafType = z.enum(["metric", "measure"]);
export type MetricLeafType = z.infer<typeof MetricLeafType>;

// A metric or measure reference. `lib/uuid` names this instance of the source, so the same
// metric can appear twice in one expression and be filtered or projected separately.
export const MetricLeafRef = z.tuple([
  MetricLeafType,
  z.object({ "lib/uuid": z.string().min(1) }).strict(),
  z.number().int().positive(),
]);
export type MetricLeafRef = z.infer<typeof MetricLeafRef>;

export const MetricMathOperator = z.enum(["+", "-", "*", "/"]);
export type MetricMathOperator = z.infer<typeof MetricMathOperator>;

export type MetricMathExpression =
  | MetricLeafRef
  | number
  | [
      MetricMathOperator,
      ClauseOptions,
      MetricMathExpression,
      MetricMathExpression,
      ...MetricMathExpression[],
    ];

export const MetricMathExpression: z.ZodType<MetricMathExpression> = z.lazy(() =>
  z.union([
    MetricLeafRef,
    z.number(),
    z
      .tuple([MetricMathOperator, ClauseOptions, MetricMathExpression, MetricMathExpression])
      .rest(MetricMathExpression),
  ]),
);

export const MetricBinning = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("default") }).strict(),
  z.object({ strategy: z.literal("bin-width"), "bin-width": z.number().positive() }).strict(),
  z.object({ strategy: z.literal("num-bins"), "num-bins": z.number().int().positive() }).strict(),
]);
export type MetricBinning = z.infer<typeof MetricBinning>;

export const MetricDimensionRefOptions = z
  .object({
    "lib/uuid": z.string().min(1).optional(),
    "display-name": z.string().min(1).nullable().optional(),
    "effective-type": FieldBaseType.nullable().optional(),
    "semantic-type": FieldSemanticType.nullable().optional(),
    "temporal-unit": TemporalUnit.nullable().optional(),
    binning: MetricBinning.nullable().optional(),
  })
  .strict();
export type MetricDimensionRefOptions = z.infer<typeof MetricDimensionRefOptions>;

export const MetricDimensionRef = z.tuple([
  z.literal("dimension"),
  MetricDimensionRefOptions,
  z.string().min(1),
]);
export type MetricDimensionRef = z.infer<typeof MetricDimensionRef>;

export type MetricFilterClause = [string, ClauseOptions, ...MetricFilterArgument[]];
export type MetricFilterArgument =
  | MetricDimensionRef
  | MetricFilterClause
  | string
  | number
  | boolean
  | null;

const MetricFilterArgument: z.ZodType<MetricFilterArgument> = z.lazy(() =>
  z.union([MetricDimensionRef, MetricFilterClause, z.string(), z.number(), z.boolean(), z.null()]),
);

// `and`, `or` and `not` nest clauses, so a clause is its own argument type.
export const MetricFilterClause: z.ZodType<MetricFilterClause> = z.lazy(() =>
  z.tuple([z.string().min(1), ClauseOptions]).rest(MetricFilterArgument),
);

export const MetricInstanceFilter = z
  .object({
    "lib/uuid": z.string().min(1),
    filter: MetricFilterClause,
  })
  .strict();
export type MetricInstanceFilter = z.infer<typeof MetricInstanceFilter>;

export const MetricProjection = z
  .object({
    type: MetricLeafType,
    id: z.number().int().positive(),
    "lib/uuid": z.string().min(1),
    projection: z.array(MetricDimensionRef),
  })
  .strict();
export type MetricProjection = z.infer<typeof MetricProjection>;

export const MetricDefinition = z
  .object({
    expression: MetricMathExpression,
    filters: z.array(MetricInstanceFilter).nullable().optional(),
    projections: z.array(MetricProjection).nullable().optional(),
  })
  .strict();
export type MetricDefinition = z.infer<typeof MetricDefinition>;

// The breakout column's metadata is the first column of a values-only run, and an empty map when
// the plan produced none.
export const MetricBreakoutColumn = z
  .object({
    name: z.string().optional(),
    display_name: z.string().optional(),
    base_type: FieldBaseType.optional(),
    effective_type: FieldBaseType.optional(),
    semantic_type: FieldSemanticType.nullable().optional(),
  })
  .loose();
export type MetricBreakoutColumn = z.infer<typeof MetricBreakoutColumn>;

export const MetricBreakoutValues = z
  .object({
    values: z.array(z.unknown()),
    col: MetricBreakoutColumn,
  })
  .loose();
export type MetricBreakoutValues = z.infer<typeof MetricBreakoutValues>;

// The wire keeps the status keyword's namespace, unlike every other keyword on a dimension.
export const MetricDimensionStatus = z.enum(["status/active", "status/orphaned"]);
export type MetricDimensionStatus = z.infer<typeof MetricDimensionStatus>;

export const MetricDimensionSource = z
  .object({
    type: z.literal("field"),
    "field-id": z.number().int().nullable(),
  })
  .loose();
export type MetricDimensionSource = z.infer<typeof MetricDimensionSource>;

export const MetricDimensionGroup = z
  .object({
    id: z.string(),
    type: z.enum(["main", "connection"]),
    display_name: z.string(),
  })
  .loose();
export type MetricDimensionGroup = z.infer<typeof MetricDimensionGroup>;

export const MetricDimension = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    display_name: z.string().nullable(),
    description: z.string().nullable().optional(),
    effective_type: FieldBaseType.nullable(),
    semantic_type: FieldSemanticType.nullable(),
    has_field_values: z.enum(["list", "search", "none"]).optional(),
    status: MetricDimensionStatus.optional(),
    status_message: z.string().optional(),
    sources: z.array(MetricDimensionSource).optional(),
    group: MetricDimensionGroup.optional(),
    dimension_interestingness: z.number().optional(),
    default_temporal_unit: TemporalUnit.optional(),
    default: z.boolean().nullable().optional(),
  })
  .loose();
export type MetricDimension = z.infer<typeof MetricDimension>;

export const MetricMappingTarget = z.tuple([z.string(), ClauseOptions]).rest(z.unknown());
export type MetricMappingTarget = z.infer<typeof MetricMappingTarget>;

export const MetricAddableDimension = MetricDimension.extend({
  mapping_target: MetricMappingTarget,
});
export type MetricAddableDimension = z.infer<typeof MetricAddableDimension>;

export const MetricAddableGroup = z
  .object({
    group: MetricDimensionGroup.nullable(),
    dimensions: z.array(MetricAddableDimension),
  })
  .loose();
export type MetricAddableGroup = z.infer<typeof MetricAddableGroup>;

export const MetricDimensionListing = z
  .object({
    added: z.array(MetricDimension),
    addable: z.array(MetricAddableGroup),
  })
  .loose();
export type MetricDimensionListing = z.infer<typeof MetricDimensionListing>;

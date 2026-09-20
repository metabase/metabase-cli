import { z } from "zod";

import { DatasetQuery } from "./query";

const InspectorFieldStats = z
  .object({
    distinct_count: z.number().int().optional(),
    nil_percent: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    avg: z.number().optional(),
    q1: z.number().optional(),
    q3: z.number().optional(),
    earliest: z.string().optional(),
    latest: z.string().optional(),
  })
  .loose();

export const InspectorField = z
  .object({
    id: z.number().int(),
    name: z.string(),
    display_name: z.string().nullable().optional(),
    base_type: z.string(),
    semantic_type: z.string().nullable().optional(),
    stats: InspectorFieldStats.nullable().optional(),
  })
  .loose();
export type InspectorField = z.infer<typeof InspectorField>;

export const InspectorTable = z
  .object({
    table_id: z.number().int(),
    table_name: z.string(),
    schema: z.string().nullable().optional(),
    db_id: z.number().int(),
    column_count: z.number().int(),
    fields: z.array(InspectorField),
  })
  .loose();
export type InspectorTable = z.infer<typeof InspectorTable>;

export const LensComplexityLevel = z.enum(["fast", "slow", "very-slow"]);
export type LensComplexityLevel = z.infer<typeof LensComplexityLevel>;

const LensComplexity = z
  .object({
    level: LensComplexityLevel,
    score: z.number().int().optional(),
  })
  .loose();

export const LensMetadata = z
  .object({
    id: z.string(),
    display_name: z.string(),
    description: z.string().nullable().optional(),
    complexity: LensComplexity.optional(),
  })
  .loose();
export type LensMetadata = z.infer<typeof LensMetadata>;

export const TransformInspectionStatus = z.enum(["not-run", "ready"]);
export type TransformInspectionStatus = z.infer<typeof TransformInspectionStatus>;

// The discovery phase: the transform's source and target tables with their field statistics, the
// fields its query touches, and the lenses that can be opened on it.
export const TransformInspection = z
  .object({
    name: z.string(),
    description: z.string().nullable().optional(),
    status: TransformInspectionStatus,
    sources: z.array(InspectorTable),
    target: InspectorTable.nullable().optional(),
    visited_fields: z
      .object({ all: z.array(z.number().int()).optional() })
      .loose()
      .nullable()
      .optional(),
    available_lenses: z.array(LensMetadata),
  })
  .loose();
export type TransformInspection = z.infer<typeof TransformInspection>;

export const LensCardDisplay = z.enum([
  "bar",
  "row",
  "line",
  "area",
  "pie",
  "scalar",
  "gauge",
  "progress",
  "table",
  "hidden",
]);
export type LensCardDisplay = z.infer<typeof LensCardDisplay>;

const LensJoinMetadata = z
  .object({
    join_step: z.number().int().optional(),
    join_alias: z.string().optional(),
    join_strategy: z.string().optional(),
  })
  .loose();

// Lens-specific: a comparison card names its group, a join card its step, and a lens may add keys
// of its own beyond these.
export const LensCardMetadata = LensJoinMetadata.extend({
  dedup_key: z.array(z.unknown()).optional(),
  depends_on_cards: z.array(z.string()).optional(),
  group_id: z.string().optional(),
  group_role: z.enum(["input", "output"]).optional(),
  group_order: z.number().int().optional(),
  card_type: z.string().optional(),
});
export type LensCardMetadata = z.infer<typeof LensCardMetadata>;

export const LensCard = z
  .object({
    id: z.string(),
    section_id: z.string().nullable().optional(),
    title: z.string(),
    display: LensCardDisplay,
    dataset_query: DatasetQuery,
    metadata: LensCardMetadata.optional(),
  })
  .loose();
export type LensCard = z.infer<typeof LensCard>;

export const LensSection = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    layout: z.enum(["flat", "comparison"]).optional(),
  })
  .loose();
export type LensSection = z.infer<typeof LensSection>;

const LensHighlight = z
  .object({
    label: z.string(),
    value: z.unknown().optional(),
    card_id: z.string().optional(),
  })
  .loose();

const LensSummary = z
  .object({
    text: z.string().nullable().optional(),
    highlights: z.array(LensHighlight).optional(),
    alerts: z.array(z.object({}).loose()).optional(),
  })
  .loose();

// Only `name` is fixed; the other keys are the condition's own.
const LensTriggerCondition = z.object({ name: z.string() }).loose();

export const LensAlertTrigger = z
  .object({
    id: z.string(),
    condition: LensTriggerCondition,
    severity: z.enum(["info", "warning", "error"]),
    message: z.string(),
    metadata: LensJoinMetadata.optional(),
  })
  .loose();
export type LensAlertTrigger = z.infer<typeof LensAlertTrigger>;

/** The parameters a drill lens takes; `join_step` scopes a join lens to one join. */
export const LensParams = z.object({
  join_step: z.number().int().optional(),
});
export type LensParams = z.infer<typeof LensParams>;

export const LensDrillTrigger = z
  .object({
    lens_id: z.string(),
    condition: LensTriggerCondition,
    params: LensParams.loose().optional(),
    reason: z.string().optional(),
    metadata: LensJoinMetadata.optional(),
  })
  .loose();
export type LensDrillTrigger = z.infer<typeof LensDrillTrigger>;

// A lens is a set of cards, each carrying the query the caller runs through the lens query
// endpoint; the triggers describe which alerts and drill lenses the card results would light up.
export const TransformLens = z
  .object({
    id: z.string(),
    display_name: z.string(),
    complexity: LensComplexity.optional(),
    summary: LensSummary.optional(),
    sections: z.array(LensSection),
    cards: z.array(LensCard),
    drill_lenses: z.array(LensMetadata).optional(),
    alert_triggers: z.array(LensAlertTrigger).optional(),
    drill_lens_triggers: z.array(LensDrillTrigger).optional(),
  })
  .loose();
export type TransformLens = z.infer<typeof TransformLens>;

export const TransformLensQueryInput = z
  .object({
    query: DatasetQuery,
    lens_params: LensParams.nullable().optional(),
  })
  .strict();
export type TransformLensQueryInput = z.infer<typeof TransformLensQueryInput>;

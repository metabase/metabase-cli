import { z } from "zod";

import { FieldBaseType, FieldSemanticType } from "./field";
import { TransformTarget } from "./transform";

// The wire enum admits `transform` on either side of a swap, but every server throws on it; a run
// row names one only as the target the model-to-transform migration wrote.
export const ReplacementSourceType = z.enum(["card", "table"]);
export type ReplacementSourceType = z.infer<typeof ReplacementSourceType>;

export const ReplacementEntityType = z.enum([...ReplacementSourceType.options, "transform"]);
export type ReplacementEntityType = z.infer<typeof ReplacementEntityType>;

export const ReplacementRunStatus = z.enum([
  "pending",
  "started",
  "succeeded",
  "failed",
  "canceled",
  "timeout",
]);
export type ReplacementRunStatus = z.infer<typeof ReplacementRunStatus>;

export const ReplacementRun = z
  .object({
    id: z.number().int(),
    status: ReplacementRunStatus,
    is_active: z.literal(true).nullable(),
    source_entity_type: ReplacementEntityType,
    source_entity_id: z.number().int(),
    target_entity_type: ReplacementEntityType,
    target_entity_id: z.number().int(),
    progress: z.number().min(0).max(1).nullable(),
    message: z.string().nullable(),
    user_id: z.number().int().nullable(),
    start_time: z.string(),
    end_time: z.string().nullable(),
  })
  .loose();
export type ReplacementRun = z.infer<typeof ReplacementRun>;

export const ReplacementRunCompact = ReplacementRun.pick({
  id: true,
  status: true,
  source_entity_type: true,
  source_entity_id: true,
  target_entity_type: true,
  target_entity_id: true,
  progress: true,
  message: true,
  start_time: true,
  end_time: true,
}).strip();
export type ReplacementRunCompact = z.infer<typeof ReplacementRunCompact>;

// `id` is `null` for a column a card computes rather than reads from a field.
export const ReplacementColumn = z.object({
  id: z.number().int().nullable(),
  name: z.string(),
  display_name: z.string(),
  base_type: FieldBaseType.nullable(),
  effective_type: FieldBaseType.nullable(),
  semantic_type: FieldSemanticType.nullable(),
});
export type ReplacementColumn = z.infer<typeof ReplacementColumn>;

export const ReplacementColumnError = z.enum([
  "column-type-mismatch",
  "missing-primary-key",
  "missing-foreign-key",
  "foreign-key-mismatch",
]);
export type ReplacementColumnError = z.infer<typeof ReplacementColumnError>;

// Strict on every arm, so a row carrying both columns can only parse as matched and a malformed
// column is refused rather than stripped into a one-sided row.
const ReplacementColumnMatched = z
  .object({
    source: ReplacementColumn,
    target: ReplacementColumn,
    errors: z.array(ReplacementColumnError).optional(),
  })
  .strict();

const ReplacementColumnMissingOnTarget = z.object({ source: ReplacementColumn }).strict();

const ReplacementColumnMissingOnSource = z.object({ target: ReplacementColumn }).strict();

export const ReplacementColumnMapping = z.union([
  ReplacementColumnMatched,
  ReplacementColumnMissingOnTarget,
  ReplacementColumnMissingOnSource,
]);
export type ReplacementColumnMapping = z.infer<typeof ReplacementColumnMapping>;

export const ReplacementError = z.enum([
  "cycle-detected",
  "database-mismatch",
  "incompatible-implicit-joins",
  "affects-gtap-policies",
]);
export type ReplacementError = z.infer<typeof ReplacementError>;

export const ReplacementCheck = z.object({
  success: z.boolean(),
  errors: z.array(ReplacementError).optional(),
  column_mappings: z.array(ReplacementColumnMapping).optional(),
});
export type ReplacementCheck = z.infer<typeof ReplacementCheck>;

export const ReplacementSourceInput = z
  .object({
    source_entity_id: z.number().int().positive(),
    source_entity_type: ReplacementSourceType,
    target_entity_id: z.number().int().positive(),
    target_entity_type: ReplacementSourceType,
  })
  .strict();
export type ReplacementSourceInput = z.infer<typeof ReplacementSourceInput>;

export const ReplacementModelWithTransformInput = z
  .object({
    card_id: z.number().int().positive(),
    transform_name: z.string(),
    transform_target: TransformTarget,
    target_collection_id: z.number().int().positive().nullable().optional(),
    transform_tag_ids: z.array(z.number().int().positive()).nullable().optional(),
  })
  .strict();
export type ReplacementModelWithTransformInput = z.infer<typeof ReplacementModelWithTransformInput>;

export const ReplacementRunStarted = z.object({ run_id: z.number().int().positive() });
export type ReplacementRunStarted = z.infer<typeof ReplacementRunStarted>;

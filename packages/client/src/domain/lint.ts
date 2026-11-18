import { z } from "zod";

import { DependencyErrorSourceType } from "./dependency";

export const LintStatus = z.enum(["passed", "failed"]);
export type LintStatus = z.infer<typeof LintStatus>;

export const LintSeverity = z.enum(["error", "warning"]);
export type LintSeverity = z.infer<typeof LintSeverity>;

export const LintEntityType = z.enum(["card", "transform", "segment"]);
export type LintEntityType = z.infer<typeof LintEntityType>;

// `entity_id` and `name` are null when the cause no longer exists; `entity_id` is always null for a table.
export const LintCause = z
  .object({
    type: DependencyErrorSourceType,
    id: z.number().int(),
    entity_id: z.string().nullable(),
    name: z.string().nullable(),
  })
  .loose();
export type LintCause = z.infer<typeof LintCause>;

// A rule id is an open string, not a pinned enum: the server's rule set is meant to grow, and the
// report describes each rule it names in `rules`, so a rule this client has not seen still reads.
export const LintRuleId = z.string();
export type LintRuleId = z.infer<typeof LintRuleId>;

export const LintResult = z
  .object({
    ruleId: LintRuleId,
    entity_id: z.string(),
    message: z.string(),
    detail: z.string().nullable(),
    cause: LintCause.nullable(),
  })
  .loose();
export type LintResult = z.infer<typeof LintResult>;

export const LintRule = z
  .object({
    severity: LintSeverity,
    description: z.string(),
  })
  .loose();
export type LintRule = z.infer<typeof LintRule>;

export const LintEntity = z
  .object({
    id: z.number().int(),
    type: LintEntityType,
    data: z
      .object({
        name: z.string(),
        collection_id: z.number().int().nullable(),
      })
      .loose(),
  })
  .loose();
export type LintEntity = z.infer<typeof LintEntity>;

export const LintSummary = z
  .object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    entities: z.number().int().nonnegative(),
  })
  .loose();
export type LintSummary = z.infer<typeof LintSummary>;

export const LintReport = z
  .object({
    status: LintStatus,
    summary: LintSummary,
    entities: z.record(z.string(), LintEntity),
    rules: z.record(LintRuleId, LintRule),
    results: z.array(LintResult),
  })
  .loose();
export type LintReport = z.infer<typeof LintReport>;

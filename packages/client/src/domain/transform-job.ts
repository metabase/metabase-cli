import { z } from "zod";

import type { Features } from "../version/features";
import { CronUiDisplayType } from "./cron";

const JobRunStatus = z.enum(["started", "succeeded", "failed", "timeout"]);

const JobRunMethod = z.enum(["manual", "cron"]);

const JobLastRun = z
  .object({
    id: z.number().int(),
    job_id: z.number().int(),
    run_method: JobRunMethod,
    status: JobRunStatus,
    start_time: z.string(),
    end_time: z.string().nullable().optional(),
    message: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();

const JobNextRun = z
  .object({
    start_time: z.string(),
  })
  .loose();

const TransformJobBase = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    schedule: z.string(),
    ui_display_type: CronUiDisplayType,
    entity_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    built_in_type: z.string().nullable().optional(),
    tag_ids: z.array(z.number().int()).optional(),
    last_run: JobLastRun.nullable().optional(),
    next_run: JobNextRun.nullable().optional(),
  })
  .loose();

// `active` is null on a server whose jobs cannot be switched off: every job there runs on schedule.
export const TransformJob = TransformJobBase.extend({
  active: z.boolean().nullable(),
});
export type TransformJob = z.infer<typeof TransformJob>;

function alwaysActive(wire: z.infer<typeof TransformJobBase>): TransformJob {
  return { ...wire, active: null };
}

/** The shape every transform-job endpoint answers on a server with `features`, read as `TransformJob`. */
export function transformJobSchema(features: Features): z.ZodType<TransformJob> {
  return features.transformJobActivation ? TransformJob : TransformJobBase.transform(alwaysActive);
}

export const TransformJobCompact = TransformJob.pick({
  id: true,
  name: true,
  description: true,
  schedule: true,
  ui_display_type: true,
  active: true,
  built_in_type: true,
}).strip();
export type TransformJobCompact = z.infer<typeof TransformJobCompact>;

export const TransformJobCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1).nullable().optional(),
    schedule: z.string().min(1),
    ui_display_type: CronUiDisplayType.optional(),
    tag_ids: z.array(z.number().int().positive()).optional(),
  })
  .loose();
export type TransformJobCreateInput = z.infer<typeof TransformJobCreateInput>;

export const TransformJobUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().min(1).nullable().optional(),
    schedule: z.string().min(1).optional(),
    ui_display_type: CronUiDisplayType.optional(),
    active: z.boolean().optional(),
    tag_ids: z.array(z.number().int().positive()).optional(),
  })
  .loose();
export type TransformJobUpdateInput = z.infer<typeof TransformJobUpdateInput>;

// One generation of servers answers `job_run_id` as an opaque stub string whatever happened; the
// other answers the run's numeric id, or null when nothing was started. `started` and `run_id` are
// both null for the first, so neither answer is folded into the other.
export const TransformJobRunResult = z.object({
  message: z.string(),
  started: z.boolean().nullable(),
  run_id: z.number().int().positive().nullable(),
});
export type TransformJobRunResult = z.infer<typeof TransformJobRunResult>;

const TransformJobRunWireV59 = z.object({
  message: z.string(),
  job_run_id: z.string(),
});

const TransformJobRunWireV64 = z.object({
  message: z.string(),
  job_run_id: z.number().int().positive().nullable(),
});

function fromStubRunId(wire: z.infer<typeof TransformJobRunWireV59>): TransformJobRunResult {
  return { message: wire.message, started: null, run_id: null };
}

function fromNumericRunId(wire: z.infer<typeof TransformJobRunWireV64>): TransformJobRunResult {
  return { message: wire.message, started: wire.job_run_id !== null, run_id: wire.job_run_id };
}

/** The shape `POST /api/transform-job/{id}/run` answers on a server with `features`, read as `TransformJobRunResult`. */
export function transformJobRunResultSchema(features: Features): z.ZodType<TransformJobRunResult> {
  return features.transformJobRunIdIsNumeric
    ? TransformJobRunWireV64.transform(fromNumericRunId)
    : TransformJobRunWireV59.transform(fromStubRunId);
}

export const TransformJobActiveResult = z.object({
  updated: z.number().int(),
  failed: z.number().int(),
});
export type TransformJobActiveResult = z.infer<typeof TransformJobActiveResult>;

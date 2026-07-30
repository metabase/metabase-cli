import { z } from "zod";

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

export const TransformJob = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    schedule: z.string(),
    ui_display_type: CronUiDisplayType,
    active: z.boolean().optional(),
    entity_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    built_in_type: z.string().nullable().optional(),
    tag_ids: z.array(z.number().int()).optional(),
    last_run: JobLastRun.nullable().optional(),
    next_run: JobNextRun.nullable().optional(),
  })
  .loose();
export type TransformJob = z.infer<typeof TransformJob>;

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

// Released servers answer with an opaque stub string; head returns the numeric run id, or null when
// nothing was started — the job is already running, or resolves to no transforms. `message` is the
// constant "Job run started" in every case, so `job_run_id` is the only signal a caller can read.
export const TransformJobRunResult = z.object({
  message: z.string(),
  job_run_id: z.union([z.string(), z.number().int().positive()]).nullable(),
});
export type TransformJobRunResult = z.infer<typeof TransformJobRunResult>;

export const TransformJobActiveResult = z.object({
  updated: z.number().int(),
  failed: z.number().int(),
});
export type TransformJobActiveResult = z.infer<typeof TransformJobActiveResult>;

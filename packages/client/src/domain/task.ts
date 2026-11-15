import { z } from "zod";

export const TaskRunType = z.enum(["subscription", "alert", "sync", "fingerprint"]);
export type TaskRunType = z.infer<typeof TaskRunType>;

export const TaskRunEntityType = z.enum(["database", "card", "dashboard"]);
export type TaskRunEntityType = z.infer<typeof TaskRunEntityType>;

export const TaskRunStatus = z.enum(["started", "success", "failed", "abandoned"]);
export type TaskRunStatus = z.infer<typeof TaskRunStatus>;

export const TaskRun = z
  .object({
    id: z.number().int(),
    run_type: TaskRunType,
    entity_type: TaskRunEntityType,
    entity_id: z.number().int(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    status: TaskRunStatus,
    entity_name: z.string().nullable().optional(),
    task_count: z.number().int().optional(),
    success_count: z.number().int().optional(),
    failed_count: z.number().int().optional(),
  })
  .loose();
export type TaskRun = z.infer<typeof TaskRun>;

export const TaskRunCompact = TaskRun.pick({
  id: true,
  run_type: true,
  entity_type: true,
  entity_id: true,
  status: true,
  started_at: true,
  ended_at: true,
}).strip();
export type TaskRunCompact = z.infer<typeof TaskRunCompact>;

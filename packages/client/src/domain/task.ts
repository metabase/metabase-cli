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
    entity_name: z.string().nullable(),
    task_count: z.number().int(),
    success_count: z.number().int(),
    failed_count: z.number().int(),
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

export const TaskHistoryStatus = z.enum(["started", "success", "failed", "unknown"]);
export type TaskHistoryStatus = z.infer<typeof TaskHistoryStatus>;

// Free-form per task; a failed task's details carry the exception's message.
export const TaskHistoryDetails = z
  .object({
    message: z.string().nullable().optional(),
  })
  .loose();
export type TaskHistoryDetails = z.infer<typeof TaskHistoryDetails>;

export const TaskHistory = z
  .object({
    id: z.number().int(),
    task: z.string(),
    db_id: z.number().int().nullable(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    duration: z.number().int().nullable(),
    status: TaskHistoryStatus,
    task_details: TaskHistoryDetails.nullable(),
  })
  .loose();
export type TaskHistory = z.infer<typeof TaskHistory>;

export const TaskRunWithTasks = TaskRun.extend({
  tasks: z.array(TaskHistory),
});
export type TaskRunWithTasks = z.infer<typeof TaskRunWithTasks>;

import { z } from "zod";

import { TransformRun } from "./transform";

// A run that a job or DAG run coordinated names its coordinator in exactly one of the two ids.
export const TransformMemberRun = TransformRun.extend({
  job_run_id: z.number().int().nullable(),
  dag_run_id: z.number().int().nullable(),
});
export type TransformMemberRun = z.infer<typeof TransformMemberRun>;

export const TransformMemberRunCompact = TransformMemberRun.pick({
  id: true,
  transform_id: true,
  dag_run_id: true,
  status: true,
  run_method: true,
  start_time: true,
  end_time: true,
  message: true,
}).strip();
export type TransformMemberRunCompact = z.infer<typeof TransformMemberRunCompact>;

import { z } from "zod";

import type { ResourceView } from "./view";

const TransformSourceType = z.enum(["native", "mbql", "python"]);

const TransformRunStatus = z.enum([
  "started",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "canceling",
]);

const TransformRunMethod = z.enum(["manual", "cron"]);

const TransformRunTrigger = z.enum(["none", "global-schedule"]);

const TransformQuerySource = z
  .object({
    type: z.literal("query"),
    query: z.unknown(),
  })
  .loose();

const TransformPythonSource = z
  .object({
    type: z.literal("python"),
    body: z.string(),
  })
  .loose();

const TransformSource = z.discriminatedUnion("type", [TransformQuerySource, TransformPythonSource]);

const TransformTableTarget = z
  .object({
    type: z.literal("table"),
    database: z.number().int().optional(),
    schema: z.string().nullable().optional(),
    name: z.string(),
  })
  .loose();

const TransformTableIncrementalTarget = z
  .object({
    type: z.literal("table-incremental"),
    database: z.number().int().optional(),
    schema: z.string().nullable().optional(),
    name: z.string(),
  })
  .loose();

const TransformTarget = z.discriminatedUnion("type", [
  TransformTableTarget,
  TransformTableIncrementalTarget,
]);

const TransformTargetCompact = z.discriminatedUnion("type", [
  TransformTableTarget.strip(),
  TransformTableIncrementalTarget.strip(),
]);

const TransformLastRun = z
  .object({
    id: z.number().int(),
    transform_id: z.number().int(),
    run_method: TransformRunMethod,
    status: TransformRunStatus,
    start_time: z.string(),
    end_time: z.string().nullable().optional(),
    message: z.string().nullable(),
    user_id: z.number().int().nullable(),
  })
  .loose();

export const TransformRun = z
  .object({
    id: z.number().int(),
    transform_id: z.number().int().nullable(),
    run_method: TransformRunMethod,
    status: TransformRunStatus,
    is_active: z.boolean().nullable(),
    start_time: z.string(),
    end_time: z.string().nullable().optional(),
    message: z.string().nullable(),
    user_id: z.number().int().nullable(),
  })
  .loose();
export type TransformRun = z.infer<typeof TransformRun>;

export const TransformRunCompact = TransformRun.pick({
  id: true,
  transform_id: true,
  status: true,
  run_method: true,
  start_time: true,
  end_time: true,
  message: true,
}).strip();
export type TransformRunCompact = z.infer<typeof TransformRunCompact>;

export const transformRunView: ResourceView<TransformRun> = {
  compactPick: TransformRunCompact,
  tableColumns: [
    { key: "id", label: "Run ID" },
    { key: "transform_id", label: "Transform" },
    { key: "status", label: "Status" },
    { key: "run_method", label: "Method" },
    { key: "start_time", label: "Started" },
    { key: "end_time", label: "Ended" },
    { key: "message", label: "Message" },
  ],
};

export const Transform = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    source: TransformSource,
    target: TransformTarget,
    source_type: TransformSourceType,
    source_database_id: z.number().int().nullable().optional(),
    target_db_id: z.number().int().nullable().optional(),
    target_table_id: z.number().int().nullable().optional(),
    entity_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    creator_id: z.number().int(),
    collection_id: z.number().int().nullable(),
    run_trigger: TransformRunTrigger.nullable().optional(),
    last_run: TransformLastRun.nullable().optional(),
    tag_ids: z.array(z.number().int()).optional(),
  })
  .loose();
export type Transform = z.infer<typeof Transform>;

export const TransformCompact = Transform.pick({
  id: true,
  name: true,
  description: true,
  source_type: true,
  target_db_id: true,
})
  .strip()
  .extend({ target: TransformTargetCompact });
export type TransformCompact = z.infer<typeof TransformCompact>;

export const transformView: ResourceView<Transform> = {
  compactPick: TransformCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "source_type", label: "Source" },
    { key: "target", label: "Target", format: (value) => formatTarget(value) },
    { key: "target_db_id", label: "Target DB" },
    { key: "description", label: "Description" },
  ],
};

function formatTarget(value: unknown): string {
  const parsed = TransformTarget.safeParse(value);
  if (!parsed.success) {
    return "";
  }
  const { schema, name } = parsed.data;
  return schema ? `${schema}.${name}` : name;
}

export const TransformCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    source: TransformSource,
    target: TransformTarget,
    run_trigger: TransformRunTrigger.optional(),
    tag_ids: z.array(z.number().int().positive()).optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    owner_user_id: z.number().int().positive().nullable().optional(),
    owner_email: z.string().nullable().optional(),
  })
  .loose();
export type TransformCreateInput = z.infer<typeof TransformCreateInput>;

export const TransformUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    source: TransformSource.optional(),
    target: TransformTarget.optional(),
    run_trigger: TransformRunTrigger.optional(),
    tag_ids: z.array(z.number().int().positive()).optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    owner_user_id: z.number().int().positive().nullable().optional(),
    owner_email: z.string().nullable().optional(),
  })
  .loose();
export type TransformUpdateInput = z.infer<typeof TransformUpdateInput>;

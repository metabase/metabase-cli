import { z } from "zod";

import type { Features } from "../version/features";

const TransformSourceType = z.enum(["native", "mbql", "python"]);

export const TransformRunStatus = z.enum([
  "started",
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "canceling",
]);
export type TransformRunStatus = z.infer<typeof TransformRunStatus>;

const TERMINAL_STATUSES = new Set<TransformRunStatus>([
  "succeeded",
  "failed",
  "timeout",
  "canceled",
]);

const FAILURE_STATUSES = new Set<TransformRunStatus>(["failed", "timeout", "canceled"]);

/** Whether the server will report any further progress for a run in this status. */
export function isTransformRunTerminal(status: TransformRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Whether a terminal status means the run did not produce its target table. */
export function isTransformRunFailed(status: TransformRunStatus): boolean {
  return FAILURE_STATUSES.has(status);
}

export const TransformRunMethod = z.enum(["manual", "cron"]);
export type TransformRunMethod = z.infer<typeof TransformRunMethod>;

const TransformRunTrigger = z.enum(["none", "global-schedule"]);

const TransformCheckpointStrategy = z
  .object({
    type: z.literal("checkpoint"),
    "checkpoint-filter-field-id": z.number().int().positive().optional(),
  })
  .loose();

// `schema` may be absent so a reference a server keying the tables by alias stored without one can
// be written back; a server that requires it answers its own 400.
const TransformSourceTableRefInput = z
  .object({
    alias: z.string(),
    database_id: z.number().int(),
    schema: z.string().nullable().optional(),
    table: z.string().optional(),
    table_id: z.number().int().nullable().optional(),
  })
  .loose();

// An entry naming its table by id alone, as a server keying the tables by alias holds one and the
// readers below answer it, so a transform read from that server can be written back to it.
const TransformSourceTableIdInput = z
  .object({
    alias: z.string(),
    table_id: z.number().int(),
    database_id: z.null().optional(),
    schema: z.null().optional(),
    table: z.null().optional(),
  })
  .loose();
type TransformSourceTableIdInput = z.infer<typeof TransformSourceTableIdInput>;

export const TransformSourceTableEntryInput = z.union([
  TransformSourceTableRefInput,
  TransformSourceTableIdInput,
]);
export type TransformSourceTableEntryInput = z.infer<typeof TransformSourceTableEntryInput>;

function namesTableByIdAlone(
  entry: TransformSourceTableEntryInput,
): entry is TransformSourceTableIdInput {
  return typeof entry.database_id !== "number";
}

// The server requires only `alias`, and keeps an entry whose table or database is gone without the
// rest. `database_id`, `schema` and `table` are null where a server keying the tables by alias names
// a table by its id alone, and so cannot say.
export const TransformSourceTableEntry = TransformSourceTableRefInput.extend({
  database_id: z.number().int().nullable().optional(),
  schema: z.string().nullable().optional(),
  table: z.string().nullable().optional(),
});
export type TransformSourceTableEntry = z.infer<typeof TransformSourceTableEntry>;

const TransformQuerySource = z
  .object({
    type: z.literal("query"),
    query: z.unknown().describe("Native SQL or MBQL query"),
    "source-incremental-strategy": TransformCheckpointStrategy.optional(),
  })
  .loose();

const TransformPythonSource = z
  .object({
    type: z.literal("python"),
    body: z.string(),
    "source-tables": z.array(TransformSourceTableEntry),
    "source-database": z.number().int().optional(),
    "source-incremental-strategy": TransformCheckpointStrategy.optional(),
  })
  .loose();

const TransformSource = z.discriminatedUnion("type", [TransformQuerySource, TransformPythonSource]);
type TransformSource = z.infer<typeof TransformSource>;

// A server without the list keys a Python source's tables by alias. It stores each value as a table
// id or a reference by name, but answers every read with the table id alone, `null` for a reference
// whose table is not found. Its entry takes the alias from the key, as the server's own migration to
// the list does; that migration reads the database, schema and name of an id off the table row.
const TransformSourceTableRefWireV59 = z
  .object({
    database_id: z.number().int(),
    schema: z.string().nullable().optional(),
    table: z.string(),
    table_id: z.number().int().nullable().optional(),
  })
  .loose();

const TransformSourceTableWireV59 = z.union([
  z.number().int(),
  z.null(),
  TransformSourceTableRefWireV59,
]);

const TransformSourceTablesWireV59 = z.record(z.string(), TransformSourceTableWireV59);

function toSourceTableEntry(
  alias: string,
  wire: z.infer<typeof TransformSourceTableWireV59>,
): TransformSourceTableEntry {
  if (wire === null || typeof wire === "number") {
    return { alias, table_id: wire, database_id: null, schema: null, table: null };
  }
  return { ...wire, alias };
}

function fromAliasMap(
  wire: z.infer<typeof TransformSourceTablesWireV59>,
): TransformSourceTableEntry[] {
  return Object.entries(wire).map(([alias, value]) => toSourceTableEntry(alias, value));
}

const TransformPythonSourceWireV59 = TransformPythonSource.extend({
  "source-tables": TransformSourceTablesWireV59.transform(fromAliasMap),
});

const TransformSourceWireV59 = z.discriminatedUnion("type", [
  TransformQuerySource,
  TransformPythonSourceWireV59,
]);

function transformSourceSchema(features: Features): z.ZodType<TransformSource> {
  return features.transformSourceTablesAsList ? TransformSource : TransformSourceWireV59;
}

const TransformPythonSourceInput = TransformPythonSource.extend({
  "source-tables": z.array(TransformSourceTableEntryInput),
});

const TransformSourceInput = z.discriminatedUnion("type", [
  TransformQuerySource,
  TransformPythonSourceInput,
]);
type TransformSourceInput = z.infer<typeof TransformSourceInput>;

// Inverts what a server without the list reads: the alias becomes the key, and the value is the bare
// table id an entry naming its table by id alone was read from, else the reference less its alias,
// which 59 reads and 58, taking only table ids, refuses with its own 400.
function toAliasMapValue(entry: TransformSourceTableEntryInput) {
  const { alias: _alias, ...reference } = entry;
  return namesTableByIdAlone(entry) ? entry.table_id : reference;
}

/** Each entry keyed by its alias, its value chosen by `value`, as a server without the list reads it. */
export function keyedByAlias<T>(
  entries: readonly TransformSourceTableEntryInput[],
  value: (entry: TransformSourceTableEntryInput) => T,
): Record<string, T> {
  return Object.fromEntries(entries.map((entry) => [entry.alias, value(entry)]));
}

/** A transform body's `source` as a server with `features` reads it. */
export function transformSourceBody(source: TransformSourceInput, features: Features) {
  if (features.transformSourceTablesAsList || source.type !== "python") {
    return source;
  }
  return { ...source, "source-tables": keyedByAlias(source["source-tables"], toAliasMapValue) };
}

const TransformAppendStrategy = z.object({ type: z.literal("append") }).loose();

const TransformMergeKeyColumn = z
  .object({
    name: z.string().min(1).optional(),
    "field-id": z.number().int().positive().nullable().optional(),
  })
  .loose();

const TransformMergeStrategy = z
  .object({
    type: z.literal("merge"),
    "unique-key": z.array(TransformMergeKeyColumn),
  })
  .loose();

const TransformTargetIncrementalStrategy = z.discriminatedUnion("type", [
  TransformAppendStrategy,
  TransformMergeStrategy,
]);

const TransformTableTarget = z
  .object({
    type: z.literal("table"),
    database: z.number().int().optional(),
    schema: z.string().min(1).nullable().optional(),
    name: z.string(),
  })
  .loose();

const TransformTableIncrementalTarget = z
  .object({
    type: z.literal("table-incremental"),
    database: z.number().int().optional(),
    schema: z.string().min(1).nullable().optional(),
    name: z.string(),
    "target-incremental-strategy": TransformTargetIncrementalStrategy,
  })
  .loose();

export const TransformTarget = z.discriminatedUnion("type", [
  TransformTableTarget,
  TransformTableIncrementalTarget,
]);
export type TransformTarget = z.infer<typeof TransformTarget>;

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

// `run_id` is null when the server accepted the request without starting a run, and `final` is null
// whenever no run was polled — either because the caller did not ask to wait or because there was
// no run to wait for. `target_table_id` is present only for a caller that asked to follow the
// output table, and null when the table was not registered before the wait ran out.
export const TransformRunResult = z.object({
  message: z.string(),
  run_id: z.number().int().positive().nullable(),
  final: TransformRun.nullable(),
  target_table_id: z.number().int().nullable().optional(),
});
export type TransformRunResult = z.infer<typeof TransformRunResult>;

/** Which transforms a DAG reprocess from a seed transform runs, besides the seed itself. */
export const TransformDagDirection = z.enum(["upstream", "downstream"]);
export type TransformDagDirection = z.infer<typeof TransformDagDirection>;

// `dag_run_id` is null when the server ran nothing: a DAG run for the seed transform was already
// in progress, or its closure in the chosen direction was empty.
export const TransformDagRunResult = z.object({
  message: z.string(),
  dag_run_id: z.number().int().positive().nullable(),
});
export type TransformDagRunResult = z.infer<typeof TransformDagRunResult>;

export const TransformDagTransform = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type TransformDagTransform = z.infer<typeof TransformDagTransform>;

export const TransformRunSummaryType = z.enum(["job", "dag", "transform"]);
export type TransformRunSummaryType = z.infer<typeof TransformRunSummaryType>;

export const TransformRunSummarySortColumn = z.enum(["start_time", "end_time"]);
export type TransformRunSummarySortColumn = z.infer<typeof TransformRunSummarySortColumn>;

// One root run of the unified history: a job run, a DAG reprocess run, or a standalone transform
// run, never a member run of a job or DAG. `entity_id` is the job or transform that ran, null once
// it is deleted; `name` is that entity's live name, else the one snapshotted when the run started.
// `direction` and `transform_count` are set on DAG runs only.
export const TransformRunSummary = z
  .object({
    run_type: TransformRunSummaryType,
    id: z.number().int(),
    entity_id: z.number().int().nullable(),
    name: z.string().nullable(),
    direction: TransformDagDirection.nullable(),
    transform_count: z.number().int().nullable(),
    run_method: TransformRunMethod.nullable(),
    status: TransformRunStatus,
    is_active: z.boolean().nullable(),
    start_time: z.string(),
    end_time: z.string().nullable().optional(),
    message: z.string().nullable(),
    user_id: z.number().int().nullable(),
  })
  .loose();
export type TransformRunSummary = z.infer<typeof TransformRunSummary>;

export const TransformRunSummaryCompact = TransformRunSummary.pick({
  run_type: true,
  id: true,
  entity_id: true,
  name: true,
  status: true,
  run_method: true,
  start_time: true,
  end_time: true,
  message: true,
}).strip();
export type TransformRunSummaryCompact = z.infer<typeof TransformRunSummaryCompact>;

const TransformBase = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    source: TransformSource,
    target: TransformTarget,
    source_type: TransformSourceType,
    source_database_id: z.number().int().nullable().optional(),
    target_db_id: z.number().int().nullable().optional(),
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

// `target_table_id` is the output table's id once the server has registered one, and null until
// then. Servers without the column answer it through the converters below, so null also covers
// "this server cannot say on this endpoint".
export const Transform = TransformBase.extend({
  target_table_id: z.number().int().nullable(),
});
export type Transform = z.infer<typeof Transform>;

// A server without the column links the output table only on the detail, as the hydrated `table`
// every generation's detail carries; its other transform endpoints carry no link at all. The
// hydrated table stays in place so the detail reads the same on every server.
const TransformWireV59Detail = TransformBase.extend({
  table: z.object({ id: z.number().int() }).loose().nullable(),
});

function fromHydratedTable(wire: z.infer<typeof TransformWireV59Detail>): Transform {
  return { ...wire, target_table_id: wire.table === null ? null : wire.table.id };
}

function withoutLink(row: z.infer<typeof TransformBase>): Transform {
  return { ...row, target_table_id: null };
}

/** The shape `GET /api/transform/{id}` answers on a server with `features`, read as `Transform`. */
export function transformDetailSchema(features: Features): z.ZodType<Transform> {
  const source = transformSourceSchema(features);
  return features.transformTargetTableId
    ? Transform.extend({ source })
    : TransformWireV59Detail.extend({ source }).transform(fromHydratedTable);
}

/** The shape every other transform endpoint answers on a server with `features`, read as `Transform`. */
export function transformRowSchema(features: Features): z.ZodType<Transform> {
  const source = transformSourceSchema(features);
  return features.transformTargetTableId
    ? Transform.extend({ source })
    : TransformBase.extend({ source }).transform(withoutLink);
}

export const TransformCompact = Transform.pick({
  id: true,
  name: true,
  description: true,
  source_type: true,
  target_db_id: true,
  target_table_id: true,
})
  .strip()
  .extend({ target: TransformTargetCompact });
export type TransformCompact = z.infer<typeof TransformCompact>;

/** What a transform computes and where it writes, without where it is filed or when it runs. */
export const TransformDefinition = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    source: TransformSourceInput,
    target: TransformTarget,
  })
  .strict();
export type TransformDefinition = z.infer<typeof TransformDefinition>;

export const TransformCreateInput = TransformDefinition.extend({
  run_trigger: TransformRunTrigger.optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  collection_id: z.number().int().positive().nullable().optional(),
  owner_user_id: z.number().int().positive().nullable().optional(),
  owner_email: z.string().nullable().optional(),
}).loose();
export type TransformCreateInput = z.infer<typeof TransformCreateInput>;

export const TransformUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    source: TransformSourceInput.optional(),
    target: TransformTarget.optional(),
    run_trigger: TransformRunTrigger.optional(),
    tag_ids: z.array(z.number().int().positive()).optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    owner_user_id: z.number().int().positive().nullable().optional(),
    owner_email: z.string().nullable().optional(),
  })
  .loose();
export type TransformUpdateInput = z.infer<typeof TransformUpdateInput>;

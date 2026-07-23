import { z } from "zod";

import type { ResourceView } from "./view";

const IndexColumn = z
  .object({
    name: z.string().min(1).max(255),
    direction: z.enum(["asc", "desc"]).optional(),
  })
  .loose();

const CLASSICAL_INDEX_KINDS = [
  "btree",
  "hash",
  "gin",
  "gist",
  "brin",
  "spgist",
  "fulltext",
  "spatial",
  "clustered",
  "nonclustered",
  "columnstore",
] as const;

const ClassicalIndexStructured = z
  .object({
    kind: z.enum(CLASSICAL_INDEX_KINDS),
    name: z.string().min(1).max(63),
    columns: z.array(IndexColumn).min(1),
    include: z.array(z.string().min(1).max(255)).optional(),
    unique: z.boolean().optional(),
  })
  .loose();

const SortKeyStructured = z
  .object({
    kind: z.literal("sortkey"),
    style: z.enum(["compound", "interleaved"]),
    columns: z.array(IndexColumn).min(1),
  })
  .loose();

const DistKeyStructured = z
  .object({
    kind: z.literal("distkey"),
    style: z.enum(["key", "all", "even"]),
    columns: z.array(IndexColumn).min(1).max(1).optional(),
  })
  .loose();

const ClusteringStructured = z
  .object({
    kind: z.literal("clustering"),
    name: z.string().min(1).max(63).optional(),
    columns: z.array(IndexColumn).min(1),
  })
  .loose();

const OrderByStructured = z
  .object({
    kind: z.literal("order-by"),
    columns: z.array(IndexColumn).min(1),
  })
  .loose();

const SkipIndexStructured = z
  .object({
    kind: z.literal("skip-index"),
    name: z.string().min(1).max(63),
    columns: z.array(IndexColumn).min(1),
    type: z.enum(["minmax", "bloom_filter"]),
    granularity: z.number().int().positive().optional(),
  })
  .loose();

export const TransformIndexStructured = z.discriminatedUnion("kind", [
  ClassicalIndexStructured,
  SortKeyStructured,
  DistKeyStructured,
  ClusteringStructured,
  OrderByStructured,
  SkipIndexStructured,
]);
export type TransformIndexStructured = z.infer<typeof TransformIndexStructured>;

const TransformIndexStatus = z.enum([
  "create-pending",
  "update-pending",
  "delete-pending",
  "running",
  "succeeded",
  "failed",
]);

export const TransformIndexRequest = z
  .object({
    id: z.number().int(),
    transform_id: z.number().int(),
    index_name: z.string(),
    structured: TransformIndexStructured,
    status: TransformIndexStatus,
    error_message: z.string().nullable(),
    created_by: z.number().int().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    last_executed_at: z.string().nullable(),
  })
  .loose();
export type TransformIndexRequest = z.infer<typeof TransformIndexRequest>;

export const TransformIndexRequestCompact = TransformIndexRequest.pick({
  id: true,
  transform_id: true,
  index_name: true,
  status: true,
  structured: true,
  error_message: true,
}).strip();
export type TransformIndexRequestCompact = z.infer<typeof TransformIndexRequestCompact>;

export const transformIndexRequestView: ResourceView<TransformIndexRequest> = {
  compactPick: TransformIndexRequestCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "transform_id", label: "Transform" },
    { key: "index_name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "structured", label: "Definition", format: (value) => formatStructured(value) },
    { key: "error_message", label: "Error" },
  ],
};

export const TransformIndex = z
  .object({
    metabase_managed: z.boolean(),
    present_in_warehouse: z.boolean(),
    name: z.string().nullable(),
    kind: z.string(),
    key_columns: z.array(z.string()),
    include_columns: z.array(z.string().nullable()),
    is_unique: z.boolean(),
    is_primary: z.boolean(),
    is_valid: z.boolean(),
    partial_predicate: z.string().nullable(),
    access_method: z.string().nullable(),
    request: TransformIndexRequest.optional(),
  })
  .loose();
export type TransformIndex = z.infer<typeof TransformIndex>;

export const TransformIndexCompact = TransformIndex.pick({
  name: true,
  kind: true,
  key_columns: true,
  is_unique: true,
  is_primary: true,
  metabase_managed: true,
  present_in_warehouse: true,
})
  .strip()
  .extend({ request: TransformIndexRequestCompact.optional() });
export type TransformIndexCompact = z.infer<typeof TransformIndexCompact>;

export const transformIndexView: ResourceView<TransformIndex> = {
  compactPick: TransformIndexCompact,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "kind", label: "Kind" },
    { key: "key_columns", label: "Columns", format: (value) => formatColumnNames(value) },
    { key: "is_unique", label: "Unique" },
    { key: "metabase_managed", label: "Managed" },
    { key: "present_in_warehouse", label: "In warehouse" },
    { key: "request", label: "Request", format: (value) => formatRequestSummary(value) },
  ],
};

export const TransformIndexCreateInput = z
  .object({
    transform_id: z.number().int().positive(),
    structured: TransformIndexStructured,
  })
  .loose();
export type TransformIndexCreateInput = z.infer<typeof TransformIndexCreateInput>;

export const TransformIndexUpdateInput = z
  .object({
    structured: TransformIndexStructured,
  })
  .loose();
export type TransformIndexUpdateInput = z.infer<typeof TransformIndexUpdateInput>;

function formatStructured(value: unknown): string {
  const parsed = TransformIndexStructured.safeParse(value);
  if (!parsed.success) {
    return "";
  }
  const columns = parsed.data.columns;
  if (columns === undefined) {
    return parsed.data.kind;
  }
  return `${parsed.data.kind}(${columns.map((column) => column.name).join(", ")})`;
}

function formatColumnNames(value: unknown): string {
  const parsed = z.array(z.string()).safeParse(value);
  return parsed.success ? parsed.data.join(", ") : "";
}

function formatRequestSummary(value: unknown): string {
  const parsed = TransformIndexRequestCompact.safeParse(value);
  if (!parsed.success) {
    return "";
  }
  return `#${parsed.data.id} ${parsed.data.status}`;
}

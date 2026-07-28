import { z } from "zod";

// Warehouse identifier caps, declared so an over-long name fails before the round trip.
const IndexName = z.string().min(1).max(63);
const ColumnName = z.string().min(1).max(255);

const IndexColumn = z
  .object({
    name: ColumnName,
    direction: z.enum(["asc", "desc"]).optional(),
  })
  .loose();

const ClassicalIndexStructured = z
  .object({
    kind: z.enum([
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
    ]),
    name: IndexName,
    columns: z.array(IndexColumn).min(1),
    include: z.array(ColumnName).optional(),
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
    columns: z.tuple([IndexColumn]).optional(),
  })
  .loose();

const ClusteringStructured = z
  .object({
    kind: z.literal("clustering"),
    name: IndexName.optional(),
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
    name: IndexName,
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

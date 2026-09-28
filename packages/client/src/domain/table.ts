import { z } from "zod";

import { Field, FieldCompact } from "./field";

const TableEntityType = z.enum([
  "entity/GenericTable",
  "entity/UserTable",
  "entity/CompanyTable",
  "entity/TransactionTable",
  "entity/ProductTable",
  "entity/SubscriptionTable",
  "entity/EventTable",
]);

export const TableVisibilityType = z.enum(["hidden", "technical", "cruft"]);
export type TableVisibilityType = z.infer<typeof TableVisibilityType>;

const TableFieldOrder = z.enum(["alphabetical", "custom", "database", "smart"]);

export const Table = z
  .object({
    id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    db_id: z.number().int(),
    schema: z.string().nullable(),
    entity_type: TableEntityType.nullable(),
    visibility_type: TableVisibilityType.nullable().optional(),
    active: z.boolean().optional(),
    is_published: z.boolean().optional(),
    collection_id: z.number().int().nullable().optional(),
    fields: z.array(Field).optional(),
  })
  .loose();
export type Table = z.infer<typeof Table>;

export const TableQueryMetadata = Table.extend({
  fields: z.array(Field),
});
export type TableQueryMetadata = z.infer<typeof TableQueryMetadata>;

export const TableGetInclude = z.enum(["fields"]);
export type TableGetInclude = z.infer<typeof TableGetInclude>;

export const TableCompact = Table.pick({
  id: true,
  name: true,
  display_name: true,
  description: true,
  db_id: true,
  schema: true,
  entity_type: true,
  active: true,
  is_published: true,
})
  .strip()
  .extend({
    fields: z.array(FieldCompact).optional(),
  });
export type TableCompact = z.infer<typeof TableCompact>;

const TableDataAuthority = z.enum(["unconfigured", "authoritative", "computed", "ingested"]);

// Metabase 58 names a table's layer after a medallion metal; 59 replaced the vocabulary with one
// value fewer, so neither set maps onto the other and the canonical value is whichever the server
// speaks.
export const TableDataLayerTier = z.enum(["final", "internal", "hidden"]);
export type TableDataLayerTier = z.infer<typeof TableDataLayerTier>;

export const TableDataLayerMedallion = z.enum(["gold", "silver", "bronze", "copper"]);
export type TableDataLayerMedallion = z.infer<typeof TableDataLayerMedallion>;

export const TableDataLayer = z.enum([
  ...TableDataLayerTier.options,
  ...TableDataLayerMedallion.options,
]);
export type TableDataLayer = z.infer<typeof TableDataLayer>;

export const TableDataSource = z.enum([
  "unknown",
  "ingested",
  "metabase-transform",
  "transform",
  "source-data",
  "upload",
]);
export type TableDataSource = z.infer<typeof TableDataSource>;

export const TableUpdateInput = z
  .object({
    display_name: z.string().min(1).nullable().optional(),
    entity_type: TableEntityType.nullable().optional(),
    visibility_type: TableVisibilityType.nullable().optional(),
    description: z.string().nullable().optional(),
    caveats: z.string().nullable().optional(),
    points_of_interest: z.string().nullable().optional(),
    show_in_getting_started: z.boolean().nullable().optional(),
    field_order: TableFieldOrder.nullable().optional(),
    data_authority: TableDataAuthority.nullable().optional(),
    data_source: TableDataSource.nullable().optional(),
    data_layer: TableDataLayer.nullable().optional(),
    owner_email: z.string().nullable().optional(),
    owner_user_id: z.number().int().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type TableUpdateInput = z.infer<typeof TableUpdateInput>;

// The server splits a schema id on every `:`, reads the first part with `parse-long` as a database
// id and the second as the schema name, an absent name matching the tables that have no schema. So
// `"1:"` picks database 1's schema-less tables, a first part that is not a number selects nothing,
// and a schema name holding a `:` is cut short and selects another schema. The database id must be
// written plainly, without the sign or leading zeros `parse-long` would also read, in at most 18
// digits, which always fit a `long`.
export const TableSchemaId = z.string().regex(/^[1-9]\d{0,17}:[^:]*$/, {
  error: 'expected a schema id "<db-id>:<schema>" with a positive database id',
});

// A set of tables named by any mix of database ids, `"<db_id>:<schema>"` ids and table ids; the
// selectors are unioned. Strict because a server that drops an unknown key reads what is left as
// a selection of nothing and answers as if it had acted.
export const TableSelectors = z
  .object({
    database_ids: z.array(z.number().int().positive()).optional(),
    schema_ids: z.array(TableSchemaId).optional(),
    table_ids: z.array(z.number().int().positive()).optional(),
  })
  .strict();
export type TableSelectors = z.infer<typeof TableSelectors>;

// The metadata a bulk edit sets on every selected table. `data_authority` takes `null` only on a
// server that records user edits apart from the table, whose own column is NOT NULL.
export const TableBulkEditFields = z.object({
  data_authority: TableDataAuthority.nullable().optional(),
  data_source: TableDataSource.nullable().optional(),
  data_layer: TableDataLayerTier.nullable().optional(),
  entity_type: TableEntityType.nullable().optional(),
  owner_email: z.string().nullable().optional(),
  owner_user_id: z.number().int().nullable().optional(),
});

// Strict because the server closes the body on every generation that has the route, so a stray key
// is refused here rather than as a 400.
export const TableBulkEditInput = TableSelectors.extend(TableBulkEditFields.shape).strict();
export type TableBulkEditInput = z.infer<typeof TableBulkEditInput>;

// The single-table sync endpoints acknowledge with a fixed status, restated with the table id.
export const TableSchemaSyncResult = z.object({
  id: z.number().int(),
  status: z.literal("ok"),
});
export type TableSchemaSyncResult = z.infer<typeof TableSchemaSyncResult>;

export const TableFieldValuesResult = z.object({
  id: z.number().int(),
  status: z.literal("success"),
});
export type TableFieldValuesResult = z.infer<typeof TableFieldValuesResult>;

// The selector endpoints answer the same whether or not the selectors matched a table, so the
// confirmation is the accepted request restated; it cannot say which tables were touched.
export const TableSelectionResult = TableSelectors.extend({ accepted: z.literal(true) }).strict();
export type TableSelectionResult = z.infer<typeof TableSelectionResult>;

export const TableBulkEditResult = TableBulkEditInput.extend({
  accepted: z.literal(true),
}).strict();
export type TableBulkEditResult = z.infer<typeof TableBulkEditResult>;

// A field whose `fk_target_field_id` points into this table, the table's own fields included. Both
// ends arrive with their `table` hydrated.
const TableForeignKeyEnd = Field.extend({ table: Table });

export const TableForeignKey = z
  .object({
    relationship: z.literal("Mt1"),
    origin_id: z.number().int(),
    origin: TableForeignKeyEnd,
    destination_id: z.number().int(),
    destination: TableForeignKeyEnd,
  })
  .loose();
export type TableForeignKey = z.infer<typeof TableForeignKey>;

// The destination table is the one asked about, so only the origin keeps its table.
const TableForeignKeyOriginCompact = FieldCompact.extend({
  table: Table.pick({
    id: true,
    name: true,
    display_name: true,
    schema: true,
    db_id: true,
  }).strip(),
});

export const TableForeignKeyCompact = TableForeignKey.pick({
  relationship: true,
  origin_id: true,
  destination_id: true,
})
  .strip()
  .extend({
    origin: TableForeignKeyOriginCompact,
    destination: FieldCompact,
  });
export type TableForeignKeyCompact = z.infer<typeof TableForeignKeyCompact>;

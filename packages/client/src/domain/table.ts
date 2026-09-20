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

// A set of tables named by any mix of database ids, `"<db_id>:<schema>"` ids and table ids; the
// selectors are unioned.
export const TableSelectors = z.object({
  database_ids: z.array(z.number().int().positive()).optional(),
  schema_ids: z.array(z.string().min(1)).optional(),
  table_ids: z.array(z.number().int().positive()).optional(),
});
export type TableSelectors = z.infer<typeof TableSelectors>;

// Strict because the server closes the body on every generation that has the route, so a stray key
// is refused here rather than as a 400.
export const TableBulkEditInput = TableSelectors.extend({
  data_authority: TableDataAuthority.nullable().optional(),
  data_source: TableDataSource.nullable().optional(),
  data_layer: TableDataLayerTier.nullable().optional(),
  entity_type: TableEntityType.nullable().optional(),
  owner_email: z.string().nullable().optional(),
  owner_user_id: z.number().int().nullable().optional(),
}).strict();
export type TableBulkEditInput = z.infer<typeof TableBulkEditInput>;

// A field in another table whose `fk_target_field_id` points into this one. Loose because both
// ends arrive with their `table` hydrated.
export const TableForeignKey = z
  .object({
    relationship: z.literal("Mt1"),
    origin_id: z.number().int(),
    origin: Field,
    destination_id: z.number().int(),
    destination: Field,
  })
  .loose();
export type TableForeignKey = z.infer<typeof TableForeignKey>;

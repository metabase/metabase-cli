import { z } from "zod";

import { Field, FieldCompact } from "./field";
import type { ResourceView } from "./view";

const TableEntityType = z.enum([
  "entity/GenericTable",
  "entity/UserTable",
  "entity/CompanyTable",
  "entity/TransactionTable",
  "entity/ProductTable",
  "entity/SubscriptionTable",
  "entity/EventTable",
]);

const TableVisibilityType = z.enum(["hidden", "technical", "cruft"]);

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

export const tableView: ResourceView<Table> = {
  compactPick: TableCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "db_id", label: "DB" },
    { key: "schema", label: "Schema" },
    { key: "name", label: "Name" },
    { key: "display_name", label: "Display Name" },
    { key: "description", label: "Description" },
    { key: "is_published", label: "Published" },
  ],
};

const TableDataAuthority = z.enum(["unconfigured", "authoritative", "computed", "ingested"]);

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
    data_source: z.string().nullable().optional(),
    data_layer: z.string().nullable().optional(),
    owner_email: z.string().nullable().optional(),
    owner_user_id: z.number().int().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
  })
  .loose();
export type TableUpdateInput = z.infer<typeof TableUpdateInput>;

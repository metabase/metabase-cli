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

const TableVisibilityType = z.enum([
  "details-only",
  "hidden",
  "normal",
  "retired",
  "sensitive",
  "technical",
  "cruft",
]);

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
  ],
};

export const TableUpdateInput = z
  .object({
    display_name: z.string().min(1).optional(),
    entity_type: TableEntityType.nullable().optional(),
    visibility_type: TableVisibilityType.nullable().optional(),
    description: z.string().nullable().optional(),
    caveats: z.string().nullable().optional(),
    points_of_interest: z.string().nullable().optional(),
    show_in_getting_started: z.boolean().optional(),
    field_order: TableFieldOrder.optional(),
  })
  .loose();
export type TableUpdateInput = z.infer<typeof TableUpdateInput>;

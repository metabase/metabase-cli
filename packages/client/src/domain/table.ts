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

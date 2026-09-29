import { z } from "zod";

import { CardType } from "./card";
import { Table, TableCompact } from "./table";

// A saved question standing in as a table of the Saved Questions virtual database, id `card__<id>`.
// A database listing carries it without its columns.
export const DatabaseVirtualTable = z
  .object({
    id: z.string(),
    db_id: z.number().int(),
    display_name: z.string(),
    schema: z.string(),
    description: z.string().nullable(),
    type: CardType,
    moderated_status: z.string().nullable(),
    entity_id: z.string().nullable(),
  })
  .loose();
export type DatabaseVirtualTable = z.infer<typeof DatabaseVirtualTable>;

export const DatabaseVirtualTableCompact = DatabaseVirtualTable.pick({
  id: true,
  db_id: true,
  display_name: true,
  schema: true,
  description: true,
  type: true,
}).strip();
export type DatabaseVirtualTableCompact = z.infer<typeof DatabaseVirtualTableCompact>;

// A real table's id is a number and a virtual table's a `card__N` string, which is what tells the
// two members apart; only the Saved Questions database lists virtual ones.
export const Database = z
  .object({
    id: z.number().int(),
    name: z.string(),
    engine: z.string().optional(),
    is_saved_questions: z.boolean().optional(),
    initial_sync_status: z.string().nullable().optional(),
    tables: z.array(z.union([Table, DatabaseVirtualTable])).optional(),
  })
  .loose();
export type Database = z.infer<typeof Database>;

export const DatabaseCompact = Database.pick({
  id: true,
  name: true,
  engine: true,
  is_saved_questions: true,
})
  .strip()
  .extend({
    tables: z.array(z.union([TableCompact, DatabaseVirtualTableCompact])).optional(),
  });
export type DatabaseCompact = z.infer<typeof DatabaseCompact>;

// What `include` accepts differs between the list and the single-database endpoints: only the latter
// can hydrate a table's fields.
export const DatabaseListInclude = z.enum(["tables"]);
export type DatabaseListInclude = z.infer<typeof DatabaseListInclude>;

export const DatabaseGetInclude = z.enum(["tables", "tables.fields"]);
export type DatabaseGetInclude = z.infer<typeof DatabaseGetInclude>;

export const DatabaseSyncResult = z.object({
  id: z.number().int(),
  status: z.literal("ok"),
  initial_sync_status: z.string().nullable().optional(),
});
export type DatabaseSyncResult = z.infer<typeof DatabaseSyncResult>;

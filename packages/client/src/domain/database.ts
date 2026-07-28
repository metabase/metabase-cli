import { z } from "zod";

import { Table, TableCompact } from "./table";

export const Database = z
  .object({
    id: z.number().int(),
    name: z.string(),
    engine: z.string().optional(),
    is_saved_questions: z.boolean().optional(),
    initial_sync_status: z.string().nullable().optional(),
    tables: z.array(Table).optional(),
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
    tables: z.array(TableCompact).optional(),
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

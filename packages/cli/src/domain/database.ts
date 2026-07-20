import { z } from "zod";

import { Table, TableCompact } from "./table";
import type { ResourceView } from "./view";

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

export const databaseView: ResourceView<Database> = {
  compactPick: DatabaseCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "engine", label: "Engine" },
  ],
};

export const DatabaseTaskAck = z.object({ status: z.literal("ok") });

export const DatabaseSyncResult = z.object({
  id: z.number().int(),
  status: z.literal("ok"),
  initial_sync_status: z.string().nullable().optional(),
});
export type DatabaseSyncResult = z.infer<typeof DatabaseSyncResult>;

export const databaseSyncResultView: ResourceView<DatabaseSyncResult> = {
  compactPick: DatabaseSyncResult,
  tableColumns: [
    { key: "id", label: "Database" },
    { key: "status", label: "Status" },
    { key: "initial_sync_status", label: "Initial sync" },
  ],
};

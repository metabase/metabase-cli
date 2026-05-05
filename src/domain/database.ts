import { z } from "zod";

import type { ResourceView } from "./view";

export const Database = z
  .object({
    id: z.number().int(),
    name: z.string(),
    engine: z.string(),
  })
  .loose();
export type Database = z.infer<typeof Database>;

export const DatabaseCompact = Database.pick({ id: true, name: true, engine: true }).strip();
export type DatabaseCompact = z.infer<typeof DatabaseCompact>;

export const databaseView: ResourceView<Database> = {
  compactPick: DatabaseCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "engine", label: "Engine" },
  ],
};

import { type Database, DatabaseCompact } from "@metabase/client/domain/database";

import type { ResourceView } from "../view";

export const databaseView: ResourceView<Database> = {
  compactPick: DatabaseCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "engine", label: "Engine" },
  ],
};

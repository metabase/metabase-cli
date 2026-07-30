import {
  type Database,
  DatabaseCompact,
  DatabaseSyncResult,
} from "@metabase/client/domain/database";

import type { ResourceView } from "../view";

export const databaseView: ResourceView<Database> = {
  compactPick: DatabaseCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "engine", label: "Engine" },
  ],
};

export const databaseSyncResultView: ResourceView<DatabaseSyncResult> = {
  compactPick: DatabaseSyncResult,
  tableColumns: [
    { key: "id", label: "Database" },
    { key: "status", label: "Status" },
    { key: "initial_sync_status", label: "Initial sync" },
  ],
};

import {
  type DataSensitivityDatabaseResult,
  DataSensitivityDatabaseResultCompact,
  type DataSensitivityTableResult,
  DataSensitivityTableResultCompact,
} from "@metabase/client/domain/data-sensitivity";

import type { ResourceView } from "../view";

export const dataSensitivityTableView: ResourceView<DataSensitivityTableResult> = {
  compactPick: DataSensitivityTableResultCompact,
  tableColumns: [
    { key: "table_id", label: "Table" },
    { key: "table_name", label: "Name" },
    { key: "requests", label: "Requests" },
  ],
};

export const dataSensitivityDatabaseView: ResourceView<DataSensitivityDatabaseResult> = {
  compactPick: DataSensitivityDatabaseResultCompact,
  tableColumns: [
    { key: "database_id", label: "Database" },
    { key: "requests", label: "Requests" },
    { key: "failed", label: "Failed" },
  ],
};

import { type Table, TableCompact } from "@metabase/client/domain/table";

import type { ResourceView } from "../view";

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

import {
  type DataAction,
  DataActionCompact,
  DataActionExecuteResult,
} from "@metabase/client/domain/data-action";

import type { ResourceView } from "../view";

export const dataActionView: ResourceView<DataAction> = {
  compactPick: DataActionCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "collection_id", label: "Collection" },
    { key: "database_id", label: "Database" },
    { key: "table_id", label: "Table" },
    { key: "archived", label: "Archived" },
  ],
};

export const dataActionExecuteResultView: ResourceView<DataActionExecuteResult> = {
  compactPick: DataActionExecuteResult,
  tableColumns: [
    { key: "rows-affected", label: "Rows affected" },
    { key: "rows-updated", label: "Rows updated" },
    { key: "rows-deleted", label: "Rows deleted" },
    { key: "created-row", label: "Created row" },
  ],
};

import { FieldCompact } from "@metabase/client/domain/field";
import {
  type Table,
  TableCompact,
  type TableForeignKey,
  TableForeignKeyCompact,
} from "@metabase/client/domain/table";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

function formatFieldName(value: unknown): string {
  const parsed = FieldCompact.safeParse(value);
  return parsed.success ? parsed.data.name : MALFORMED_CELL;
}

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

export const tableForeignKeyView: ResourceView<TableForeignKey> = {
  compactPick: TableForeignKeyCompact,
  tableColumns: [
    { key: "origin_id", label: "Origin ID" },
    { key: "origin", label: "Origin Field", format: formatFieldName },
    { key: "destination_id", label: "Destination ID" },
    { key: "destination", label: "Destination Field", format: formatFieldName },
    { key: "relationship", label: "Relationship" },
  ],
};

import { z } from "zod";

import { FieldCompact } from "@metabase/client/domain/field";
import {
  type Table,
  TableBulkEditFields,
  TableBulkEditResult,
  TableCompact,
  TableFieldValuesResult,
  type TableForeignKey,
  TableForeignKeyCompact,
  TableSchemaSyncResult,
  TableSelectionResult,
  TableSelectors,
} from "@metabase/client/domain/table";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

function formatFieldName(value: unknown): string {
  const parsed = FieldCompact.safeParse(value);
  return parsed.success ? parsed.data.name : MALFORMED_CELL;
}

// A schemaless database answers its schema as `""`, which would otherwise print a leading dot.
function formatOriginField(value: unknown): string {
  const parsed = TableForeignKeyCompact.shape.origin.safeParse(value);
  if (!parsed.success) {
    return MALFORMED_CELL;
  }
  const { table, name } = parsed.data;
  const qualifiedTable = table.schema ? `${table.schema}.${table.name}` : table.name;
  return `${qualifiedTable}.${name}`;
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
    { key: "active", label: "Active" },
    { key: "is_published", label: "Published" },
  ],
};

export const tableForeignKeyView: ResourceView<TableForeignKey> = {
  compactPick: TableForeignKeyCompact,
  tableColumns: [
    { key: "origin_id", label: "Origin ID" },
    { key: "origin", label: "Origin Field", format: formatOriginField },
    { key: "destination_id", label: "Destination ID" },
    { key: "destination", label: "Destination Field", format: formatFieldName },
    { key: "relationship", label: "Relationship" },
  ],
};

const SYNC_RESULT_COLUMNS = [
  { key: "id", label: "Table" },
  { key: "status", label: "Status" },
] as const;

export const tableSchemaSyncResultView: ResourceView<TableSchemaSyncResult> = {
  compactPick: TableSchemaSyncResult,
  tableColumns: [...SYNC_RESULT_COLUMNS],
};

export const tableFieldValuesResultView: ResourceView<TableFieldValuesResult> = {
  compactPick: TableFieldValuesResult,
  tableColumns: [...SYNC_RESULT_COLUMNS],
};

// A discard is confirmed first, so its result also says whether the prompt was declined.
export const TableValuesDiscardResult = z.object({
  id: z.number().int(),
  discarded: z.boolean(),
  aborted: z.boolean(),
});
export type TableValuesDiscardResult = z.infer<typeof TableValuesDiscardResult>;

export const tableValuesDiscardResultView: ResourceView<TableValuesDiscardResult> = {
  compactPick: TableValuesDiscardResult,
  tableColumns: [
    { key: "id", label: "Table" },
    { key: "discarded", label: "Discarded" },
    { key: "aborted", label: "Aborted" },
  ],
};

const SELECTOR_COLUMNS = TableSelectors.keyof().options.map((key) => ({ key }));

export const tableSelectionResultView: ResourceView<TableSelectionResult> = {
  compactPick: TableSelectionResult,
  tableColumns: [{ key: "accepted", label: "Accepted" }, ...SELECTOR_COLUMNS],
};

export const TableSelectionDiscardResult = TableSelectionResult.extend({
  accepted: z.boolean(),
  aborted: z.boolean(),
});
export type TableSelectionDiscardResult = z.infer<typeof TableSelectionDiscardResult>;

export const tableSelectionDiscardResultView: ResourceView<TableSelectionDiscardResult> = {
  compactPick: TableSelectionDiscardResult,
  tableColumns: [
    { key: "accepted", label: "Accepted" },
    { key: "aborted", label: "Aborted" },
    ...SELECTOR_COLUMNS,
  ],
};

export const tableBulkEditResultView: ResourceView<TableBulkEditResult> = {
  compactPick: TableBulkEditResult,
  tableColumns: [
    { key: "accepted", label: "Accepted" },
    ...SELECTOR_COLUMNS,
    ...TableBulkEditFields.keyof().options.map((key) => ({ key })),
  ],
};

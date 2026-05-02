import Table from "cli-table3";

import type { ColumnDef } from "../domain/view";

export function renderTable<T>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<ColumnDef<T>>,
): string {
  const head = columns.map((column) => column.label ?? column.key);
  const widths = columns.map((column) => column.width ?? null);
  const hasWidth = widths.some((width) => width !== null);
  const table = new Table(hasWidth ? { head, colWidths: widths } : { head });
  for (const row of rows) {
    table.push(columns.map((column) => formatCell(row, column)));
  }
  return table.toString();
}

export function formatCell<T>(row: T, column: ColumnDef<T>): string {
  const value = row[column.key];
  if (column.format !== undefined) {
    return column.format(value);
  }
  return formatScalar(value);
}

export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

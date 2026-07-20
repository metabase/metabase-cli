import Table from "cli-table3";

import type { ColumnDef } from "../domain/view";

// cli-table3 colorizes headers (red) and borders (grey) by default; empty arrays disable that so
// output stays plain ASCII — composable in pipes, free of ANSI for agents, deterministic in tests.
const PLAIN_TABLE_STYLE = { head: [], border: [] };

export function renderTable<T>(
  rows: ReadonlyArray<T>,
  columns: ReadonlyArray<ColumnDef<T>>,
): string {
  const head = columns.map((column) => column.label ?? column.key);
  const widths = columns.map((column) => column.width ?? null);
  const hasWidth = widths.some((width) => width !== null);
  const table = new Table(
    hasWidth
      ? { head, colWidths: widths, style: PLAIN_TABLE_STYLE }
      : { head, style: PLAIN_TABLE_STYLE },
  );
  for (const row of rows) {
    table.push(columns.map((column) => formatCell(row, column)));
  }
  return table.toString();
}

export function renderRows(
  head: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const table = new Table({ head: [...head], style: PLAIN_TABLE_STYLE });
  for (const row of rows) {
    table.push([...row]);
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

import Table from "cli-table3";

import type { ColumnDef } from "./view";

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
  const value = column.value === undefined ? row[column.key] : column.value(row);
  if (column.format !== undefined) {
    return column.format(value);
  }
  return formatScalar(value);
}

// A cell whose value failed its schema parse. Absence renders blank (see formatScalar), so drift
// between a domain schema and the server needs a rendering that cannot be read as "no value".
export const MALFORMED_CELL = "<malformed>";

// The auth summary tables render one fixed row per profile, where a blank cell reads as a broken
// renderer rather than as missing data, so they place this glyph instead.
export const EMPTY_CELL = "—";

const C0_END = 0x1f;
const DEL = 0x7f;
const C1_END = 0x9f;

function isControl(code: number): boolean {
  return code <= C0_END || (code >= DEL && code <= C1_END);
}

// A terminal acts on a control character (a newline, ESC), so text that content authors wrote
// could forge or hide lines; it is printed escaped instead.
export function printable(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    out += isControl(code) ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }
  return out;
}

export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return printable(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

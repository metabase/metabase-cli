const COLUMN_SEPARATOR = " | ";

export interface TableData {
  columns: string[];
  rows: string[][];
}

/**
 * Cells are single-line by construction: a value carrying a newline would break the
 * one-row-per-line contract both renderings depend on.
 */
function sanitize(value: string): string {
  return value.replaceAll(/\r?\n/g, "\\n").replaceAll("\t", "  ").replaceAll("|", "\\|");
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return sanitize(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const json = JSON.stringify(value);
  return json === undefined ? "" : sanitize(json);
}

/** SQL result cells distinguish a NULL from an empty string; entity fields do not. */
export function sqlCellText(value: unknown): string {
  return value === null ? "NULL" : cellText(value);
}

export function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A compact projection carries whole nested entities — a card's collection, a field's table — and a
 * reader wants the one thing that names them. The model gets the object, because it may need the id.
 */
export function displayCellText(value: unknown): string {
  if (isRecord(value) && "name" in value) {
    const name = value["name"];
    if (typeof name === "string") {
      return sanitize(name);
    }
    // The root collection is the one that names itself with a null — an empty cell, not a JSON dump.
    if (name === null) {
      return "";
    }
  }
  return cellText(value);
}

type CellFormatter = (value: unknown) => string;

function toTable(records: readonly unknown[], cell: CellFormatter): TableData | null {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!isRecord(record)) {
      return null;
    }
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0) {
    return null;
  }
  const rows = records.map((record) =>
    columns.map((column) => (isRecord(record) ? cell(record[column]) : "")),
  );
  return { columns, rows };
}

/**
 * Projects homogeneous records into columns ordered by first appearance. Returns null when
 * an item is not a record, leaving the caller to fall back to a lossless JSON rendering.
 */
export function tableFromRecords(records: readonly unknown[]): TableData | null {
  return toTable(records, cellText);
}

export function displayTableFromRecords(records: readonly unknown[]): TableData | null {
  return toTable(records, displayCellText);
}

/**
 * Model-facing table. Unpadded on purpose: alignment padding would be charged against every
 * row, and a single long cell would widen its whole column. Column names are paid for once.
 */
export function formatModelTable(table: TableData): string {
  const lines = [table.columns.join(COLUMN_SEPARATOR)];
  for (const row of table.rows) {
    lines.push(row.join(COLUMN_SEPARATOR));
  }
  return lines.join("\n");
}

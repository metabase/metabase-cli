import type { CardQueryResult } from "../domain/card";

import { formatScalar, renderRows } from "./table";

export function formatQueryResult(result: CardQueryResult): string {
  if (result.status !== "completed" || result.data === undefined) {
    const hasError = typeof result.error === "string" && result.error !== "";
    const detail = hasError ? `: ${result.error}` : "";
    return `Query ${result.status}${detail}`;
  }
  const head = result.data.cols.map((col) => col.display_name ?? col.name);
  const rowCount = result.row_count ?? result.data.rows.length;
  const summary = `${rowCount} row${rowCount === 1 ? "" : "s"}.`;
  if (result.data.rows.length === 0) {
    return summary;
  }
  const rows = result.data.rows.map((row) =>
    Array.isArray(row) ? row.map((cell) => formatScalar(cell)) : [formatScalar(row)],
  );
  return `${renderRows(head, rows)}\n${summary}`;
}

import type { CardQueryResult } from "@metabase/client/domain/card";

import { pluralize } from "./pluralize";
import { formatScalar, renderRows } from "./table";

export function formatQueryResult(result: CardQueryResult): string {
  if (result.status !== "completed" || result.data === undefined) {
    const hasError = typeof result.error === "string" && result.error !== "";
    const detail = hasError ? `: ${result.error}` : "";
    return `Query ${result.status}${detail}`;
  }
  const head = result.data.cols.map((col) => col.display_name ?? col.name);
  const rowCount = rowCountSummary(
    result.row_count ?? result.data.rows.length,
    result.data.rows_truncated ?? result.data.pivot_rows_truncated,
  );
  const summary = withCacheNote(rowCount, result.cached);
  if (result.data.rows.length === 0) {
    return summary;
  }
  const rows = result.data.rows.map((row) => row.map((cell) => formatScalar(cell)));
  return `${renderRows(head, rows)}\n${summary}`;
}

function rowCountSummary(rowCount: number, rowLimit: number | undefined): string {
  const counted = pluralize(rowCount, "row", "rows");
  if (rowLimit === undefined) {
    return `${counted}.`;
  }
  return `${counted}, truncated by the server at ${rowLimit} rows.`;
}

function withCacheNote(summary: string, cachedAt: string | null | undefined): string {
  if (cachedAt === undefined || cachedAt === null) {
    return summary;
  }
  return `${summary} Served from the cache computed at ${cachedAt}.`;
}

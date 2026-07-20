import { CardQueryResult } from "@metabase/cli/domain";
import { z } from "zod";
import type { MetabaseToolDeps } from "./deps";
import type { JsonValue } from "./json-value";
import type { DatasetColumn } from "./payload";
import { TeachingError } from "./teaching-error";
import { datasetResult, jsonResult, type TextToolResult } from "./tool-result";

export const ROW_LIMIT_DEFAULT = 100;
export const ROW_LIMIT_MAX = 2000;

const DATASET_ENDPOINT = "/api/dataset";
const COMPLETED_STATUS = "completed";
const DETAILED_FORMAT = "detailed";

const QueryColConcise = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    base_type: z.string().optional(),
    semantic_type: z.string().nullable().optional(),
  })
  .strip();

export interface DatasetRunOptions {
  datasetQuery: JsonValue;
  rowLimit: number;
  offset: number;
  format: string;
  // Names the input to resend on continuation, e.g. "`query`" or "`sql`" — the tools are
  // stateless, so paging re-submits the query itself.
  resubmit: string;
}

export function clampRowLimit(value: number | undefined): number {
  if (value === undefined) {
    return ROW_LIMIT_DEFAULT;
  }
  if (value < 1) {
    return 1;
  }
  return Math.min(value, ROW_LIMIT_MAX);
}

export async function runDataset(
  deps: MetabaseToolDeps,
  options: DatasetRunOptions,
): Promise<TextToolResult> {
  const window = options.offset + options.rowLimit;
  const body = withConstraints(options.datasetQuery, window);
  const result = await deps.client.requestParsed(CardQueryResult, DATASET_ENDPOINT, {
    method: "POST",
    body,
  });

  if (result.status !== COMPLETED_STATUS || result.data === undefined) {
    const detail = result.error ?? `query returned status "${result.status}"`;
    throw new TeachingError(`Query failed: ${detail}`);
  }

  const allRows = toRows(result.data.rows);
  const page = allRows.slice(options.offset, options.offset + options.rowLimit);
  const hasMore = allRows.length >= window && page.length === options.rowLimit;
  const continuation = hasMore
    ? `More rows available — call again with the same ${options.resubmit} and offset ${options.offset + options.rowLimit}.`
    : undefined;

  if (options.format === DETAILED_FORMAT) {
    return jsonResult(`${page.length} rows`, {
      status: result.status,
      returned: page.length,
      offset: options.offset,
      cols: result.data.cols,
      rows: page,
      continuation,
    });
  }

  const columns: DatasetColumn[] = result.data.cols.map((col) => QueryColConcise.parse(col));
  return datasetResult({
    columns,
    rows: page,
    returned: page.length,
    offset: options.offset,
    continuation,
  });
}

export function toRows(rows: readonly unknown[]): unknown[][] {
  return rows.map((row) => {
    if (!Array.isArray(row)) {
      throw new TeachingError("A result row was not an array of values.");
    }
    return row;
  });
}

function withConstraints(query: JsonValue, window: number): JsonValue {
  const base = asObject(query);
  return { ...base, constraints: { "max-results": window, "max-results-bare-rows": window } };
}

function asObject(query: JsonValue): { [key: string]: JsonValue } {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    throw new TeachingError("A query must be a JSON object (MBQL 5 or a native-query envelope).");
  }
  return query;
}

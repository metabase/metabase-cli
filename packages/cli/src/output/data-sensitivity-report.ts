import {
  type DataSensitivityCounts,
  type DataSensitivityDatabaseResult,
  type DataSensitivityFieldResult,
  DataSensitivityStatus,
  type DataSensitivityTableEntry,
  type DataSensitivityTableResult,
  isDataSensitivityTableError,
} from "@metabase/client/domain/data-sensitivity";

import { plural, qualifiedName } from "./format";
import { renderTable } from "./table";
import type { ColumnDef } from "./view";

type DataSensitivityResult = DataSensitivityTableResult | DataSensitivityDatabaseResult;

// Text output is for a person deciding what to change, so the fields the model agreed with stay
// out unless asked for; JSON is unfiltered so an agent sees the whole diff.
export const DEFAULT_TEXT_STATUSES: readonly DataSensitivityStatus[] =
  DataSensitivityStatus.options.filter((status) => status !== "agree");

type DataSensitivityRowStatus = DataSensitivityStatus | "error";

// An error row has no field, so its field-level cells are null and its proposal cell carries the
// message.
export interface DataSensitivityRow {
  table: string;
  field: string | null;
  base_type: string | null;
  current: string | null;
  proposed: string | null;
  confidence: string | null;
  status: DataSensitivityRowStatus;
}

const rowColumns: ColumnDef<DataSensitivityRow>[] = [
  { key: "table", label: "Table" },
  { key: "field", label: "Field" },
  { key: "base_type", label: "Type" },
  { key: "current", label: "Current" },
  { key: "proposed", label: "Proposed" },
  { key: "confidence", label: "Confidence" },
  { key: "status", label: "Status" },
];

function isDatabaseResult(result: DataSensitivityResult): result is DataSensitivityDatabaseResult {
  return "tables" in result;
}

function entryRows(entry: DataSensitivityTableEntry): DataSensitivityRow[] {
  const table = qualifiedName(entry.schema, entry.table_name);
  if (isDataSensitivityTableError(entry)) {
    return [
      {
        table,
        field: null,
        base_type: null,
        current: null,
        proposed: entry.error,
        confidence: null,
        status: "error",
      },
    ];
  }
  return entry.fields.map((field) => ({
    table,
    field: field.name,
    base_type: field.base_type,
    current: field.current.data_sensitivity,
    proposed: field.proposed.data_sensitivity,
    confidence: field.proposed.confidence,
    status: field.status,
  }));
}

export function flattenRows(result: DataSensitivityResult): DataSensitivityRow[] {
  const entries: DataSensitivityTableEntry[] = isDatabaseResult(result) ? result.tables : [result];
  return entries.flatMap(entryRows);
}

type StatusFilter = ReadonlyArray<DataSensitivityStatus> | null;

function keptFields(
  fields: DataSensitivityFieldResult[],
  keep: ReadonlySet<DataSensitivityStatus>,
): DataSensitivityFieldResult[] {
  return fields.filter((field) => keep.has(field.status));
}

// A null filter keeps every field and hands the result back untouched; table errors are not
// field rows, so no filter drops them.
export function filterTableResult(
  table: DataSensitivityTableResult,
  statuses: StatusFilter,
): DataSensitivityTableResult {
  if (statuses === null) {
    return table;
  }
  return { ...table, fields: keptFields(table.fields, new Set(statuses)) };
}

export function filterDatabaseResult(
  result: DataSensitivityDatabaseResult,
  statuses: StatusFilter,
): DataSensitivityDatabaseResult {
  if (statuses === null) {
    return result;
  }
  const keep = new Set(statuses);
  return {
    ...result,
    tables: result.tables.map((entry) =>
      isDataSensitivityTableError(entry)
        ? entry
        : { ...entry, fields: keptFields(entry.fields, keep) },
    ),
  };
}

function filterResult(
  result: DataSensitivityResult,
  statuses: StatusFilter,
): DataSensitivityResult {
  return isDatabaseResult(result)
    ? filterDatabaseResult(result, statuses)
    : filterTableResult(result, statuses);
}

function countsSentence(counts: DataSensitivityCounts): string {
  return (
    `${plural(counts.fields, "field")}: ${counts.agree} agree, ${counts.disagree} disagree, ` +
    `${counts.new} new, ${counts.abstain} unsure, ${counts.dropped} no answer.`
  );
}

function usageSentence(result: DataSensitivityResult): string {
  return (
    `${plural(result.requests, "request")}, ` +
    `${result.usage.input_tokens} in / ${result.usage.output_tokens} out tokens.`
  );
}

// Counts and usage are the server's totals for the whole scan, so the summary is the same
// whatever the filter kept.
function summaryLine(result: DataSensitivityResult): string {
  if (isDatabaseResult(result)) {
    const failed = result.failed === 0 ? "" : ` (${result.failed} failed)`;
    return (
      `Scanned ${plural(result.tables.length, "table")}${failed}, ` +
      `${countsSentence(result.counts)} ${usageSentence(result)}`
    );
  }
  const sample =
    result.sample_error === null ? "" : ` Sample values unavailable: ${result.sample_error}`;
  return (
    `Scanned table ${qualifiedName(result.schema, result.table_name)}, ` +
    `${countsSentence(result.counts)} ${usageSentence(result)}${sample}`
  );
}

export function formatDataSensitivityReport(
  result: DataSensitivityResult,
  statuses: StatusFilter,
): string {
  const rows = flattenRows(filterResult(result, statuses ?? DEFAULT_TEXT_STATUSES));
  const summary = summaryLine(result);
  if (rows.length === 0) {
    return summary;
  }
  return `${summary}\n${renderTable(rows, rowColumns)}`;
}

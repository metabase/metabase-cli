import {
  type DataSensitivityCounts,
  type DataSensitivityDatabaseResult,
  type DataSensitivityFieldResult,
  type DataSensitivityStatus,
  type DataSensitivityTableEntry,
  type DataSensitivityTableResult,
  isDataSensitivityTableError,
} from "@metabase/client/domain/data-sensitivity";

import { plural, qualifiedName } from "./format";
import { renderTable } from "./table";
import type { ColumnDef } from "./view";

type DataSensitivityResult = DataSensitivityTableResult | DataSensitivityDatabaseResult;

type StatusFilter = ReadonlyArray<DataSensitivityStatus> | null;

const ARROW = "->";
const UNSURE_CELL = "?";
const NO_ANSWER_CELL = "(no answer)";
const HUMAN_SET_MARK = "*";
const HUMAN_SET_FOOTNOTE = `${HUMAN_SET_MARK} set by a person`;
const TYPE_PREFIX = "type/";

// Each LLM output gets one cell: the value alone when nothing changes, `current -> proposed` when
// it does. An error row has no field, so its field-level cells are null and the sensitivity cell
// carries the message.
interface DataSensitivityRow {
  table: string;
  field: string | null;
  base_type: string | null;
  sensitivity: string | null;
  semantic_type: string | null;
  human_set: boolean;
}

const fieldColumns: ColumnDef<DataSensitivityRow>[] = [
  { key: "field", label: "Field" },
  { key: "base_type", label: "Base type" },
  { key: "sensitivity", label: "Sensitivity" },
  { key: "semantic_type", label: "Semantic type" },
];

const tableColumn: ColumnDef<DataSensitivityRow> = { key: "table", label: "Table" };

function isDatabaseResult(result: DataSensitivityResult): result is DataSensitivityDatabaseResult {
  return "tables" in result;
}

function stripTypePrefix(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.startsWith(TYPE_PREFIX) ? value.slice(TYPE_PREFIX.length) : value;
}

function diffCell(
  current: string | null,
  proposed: string | null,
  humanSet: boolean,
): string | null {
  const shown = current === null ? null : `${current}${humanSet ? HUMAN_SET_MARK : ""}`;
  if (proposed === null || proposed === current) {
    return shown;
  }
  return shown === null ? `${ARROW} ${proposed}` : `${shown} ${ARROW} ${proposed}`;
}

function sensitivityCell(field: DataSensitivityFieldResult): string | null {
  const current = field.current.data_sensitivity;
  const humanSet = field.current.human_set;
  switch (field.status) {
    case "abstain": {
      return diffCell(current, UNSURE_CELL, humanSet);
    }
    case "dropped": {
      return diffCell(current, NO_ANSWER_CELL, humanSet);
    }
    default: {
      return diffCell(current, field.proposed.data_sensitivity, humanSet);
    }
  }
}

// The server reports the effective semantic type as the proposal, so a null proposal only happens
// when the field has none and none was suggested.
function semanticTypeCell(field: DataSensitivityFieldResult): string | null {
  const current = stripTypePrefix(field.current.semantic_type);
  const proposed = stripTypePrefix(field.proposed.semantic_type);
  return diffCell(current, proposed ?? current, false);
}

function entryRows(entry: DataSensitivityTableEntry): DataSensitivityRow[] {
  const table = qualifiedName(entry.schema, entry.table_name);
  if (isDataSensitivityTableError(entry)) {
    return [
      {
        table,
        field: null,
        base_type: null,
        sensitivity: entry.error,
        semantic_type: null,
        human_set: false,
      },
    ];
  }
  return entry.fields.map((field) => ({
    table,
    field: field.name,
    base_type: stripTypePrefix(field.base_type),
    sensitivity: sensitivityCell(field),
    semantic_type: semanticTypeCell(field),
    human_set: field.current.human_set,
  }));
}

function flattenRows(result: DataSensitivityResult): DataSensitivityRow[] {
  const entries: DataSensitivityTableEntry[] = isDatabaseResult(result) ? result.tables : [result];
  return entries.flatMap(entryRows);
}

type FieldPredicate = (field: DataSensitivityFieldResult) => boolean;

// Table errors are not field rows, so no filter drops them.
function filterFields(result: DataSensitivityResult, keep: FieldPredicate): DataSensitivityResult {
  if (isDatabaseResult(result)) {
    return {
      ...result,
      tables: result.tables.map((entry) =>
        isDataSensitivityTableError(entry)
          ? entry
          : { ...entry, fields: entry.fields.filter(keep) },
      ),
    };
  }
  return { ...result, fields: result.fields.filter(keep) };
}

// A null filter keeps every field and hands the result back untouched.
export function filterResult(
  result: DataSensitivityTableResult,
  statuses: StatusFilter,
): DataSensitivityTableResult;
export function filterResult(
  result: DataSensitivityDatabaseResult,
  statuses: StatusFilter,
): DataSensitivityDatabaseResult;
export function filterResult(
  result: DataSensitivityResult,
  statuses: StatusFilter,
): DataSensitivityResult;
export function filterResult(
  result: DataSensitivityResult,
  statuses: StatusFilter,
): DataSensitivityResult {
  if (statuses === null) {
    return result;
  }
  const keep = new Set(statuses);
  return filterFields(result, (field) => keep.has(field.status));
}

// Text output is for a person deciding what to change, so without an explicit filter it shows
// every field where either LLM output differs from what is stored.
function hasProposedChange(field: DataSensitivityFieldResult): boolean {
  return field.status !== "agree" || field.semantic_changed;
}

function countsSentence(counts: DataSensitivityCounts): string {
  return (
    `${plural(counts.fields, "field")}: ${counts.agree} agree, ${counts.disagree} disagree, ` +
    `${counts.new} new, ${counts.abstain} unsure, ${counts.dropped} no answer, ` +
    `${plural(counts.semantic_changed, "semantic type change")}.`
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
  const shown =
    statuses === null ? filterFields(result, hasProposedChange) : filterResult(result, statuses);
  const rows = flattenRows(shown);
  const summary = summaryLine(result);
  if (rows.length === 0) {
    return summary;
  }
  const columns = isDatabaseResult(result) ? [tableColumn, ...fieldColumns] : fieldColumns;
  const footnote = rows.some((row) => row.human_set) ? `\n${HUMAN_SET_FOOTNOTE}` : "";
  return `${summary}\n${renderTable(rows, columns)}${footnote}`;
}

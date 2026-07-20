import type { Theme } from "@earendil-works/pi-coding-agent";
import { entityRefOfField, entityRefOfRecord } from "../tools/entity";
import {
  type DatasetPayload,
  datasetDisplayTable,
  type JsonPayload,
  type ListPayload,
  type SectionsPayload,
  type ToolPayload,
} from "../tools/payload";
import { displayTableFromRecords, isRecord, type TableData } from "../tools/table";
import { type Linker, PLAIN_LINKER } from "./link";
import { type DisplayTable, recordLines, tableLines } from "./table-view";

const JSON_INDENT = 2;

/** The columns that name the row itself, as opposed to something the row points at. */
const SELF_COLUMNS = new Set(["id", "name"]);

export type BodySource = (width: number, theme: Theme) => string[];

export interface ResultView {
  summary: string;
  notices: string[];
  body: BodySource;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}`;
}

function jsonLines(value: unknown, theme: Theme): string[] {
  return JSON.stringify(value, null, JSON_INDENT)
    .split("\n")
    .map((line) => theme.fg("toolOutput", line));
}

/**
 * Every id a row shows is an address. Its own id and name open the row itself; a foreign key — the
 * collection it lives in, the table it reads — opens what the row points at.
 */
function rowHrefs(
  record: unknown,
  columns: readonly string[],
  noun: string | null,
  link: Linker,
): (string | null)[] {
  const self = entityRefOfRecord(record, noun);
  return columns.map((column) => {
    if (SELF_COLUMNS.has(column)) {
      return self === null ? null : link.href(self);
    }
    if (!isRecord(record)) {
      return null;
    }
    const ref = entityRefOfField(column, record[column]);
    return ref === null ? null : link.href(ref);
  });
}

export function linkTable(
  table: TableData,
  items: readonly unknown[],
  noun: string | null,
  link: Linker,
): DisplayTable {
  return { ...table, hrefs: items.map((item) => rowHrefs(item, table.columns, noun, link)) };
}

/** Records tabulate; anything else is rendered losslessly rather than forced into columns. */
function recordsBody(items: readonly unknown[], noun: string | null, link: Linker): BodySource {
  const table = displayTableFromRecords(items);
  if (table === null) {
    return (_width, theme) => jsonLines(items, theme);
  }
  const linked = linkTable(table, items, noun, link);
  return (width, theme) => tableLines(linked, width, theme);
}

function listView(payload: ListPayload, link: Linker): ResultView {
  const { returned, total, truncated } = payload.envelope;
  const summary =
    total === undefined || total === returned
      ? count(returned, payload.noun)
      : `${returned} of ${count(total, payload.noun)}`;
  return {
    summary,
    notices: truncated === undefined ? [] : [truncated.message],
    body: recordsBody(payload.envelope.data, payload.noun, link),
  };
}

function sectionsView(payload: SectionsPayload, link: Linker): ResultView {
  const items = payload.sections.reduce((sum, section) => sum + section.items.length, 0);
  const notices = [...payload.notices];
  for (const section of payload.sections) {
    if (section.notice !== undefined) {
      notices.push(section.notice);
    }
  }
  const bodies = payload.sections.map((section) => ({
    title: section.title,
    lines: recordsBody(section.items, payload.noun, link),
  }));
  return {
    summary: `${count(items, payload.noun)} across ${count(payload.sections.length, "tables")}`,
    notices,
    body: (width, theme) => {
      const lines: string[] = [];
      for (const [index, section] of bodies.entries()) {
        if (index > 0) {
          lines.push("");
        }
        lines.push(theme.bold(theme.fg("muted", section.title)));
        lines.push(...section.lines(width, theme));
      }
      return lines;
    },
  };
}

function datasetView(payload: DatasetPayload): ResultView {
  const summary = `${count(payload.returned, "rows")} × ${count(payload.columns.length, "columns")}`;
  const table = datasetDisplayTable(payload);
  return {
    summary,
    notices: payload.continuation === undefined ? [] : [payload.continuation],
    body: payload.returned === 0 ? () => [] : (width, theme) => tableLines(table, width, theme),
  };
}

/**
 * A write answers with the entity it wrote. Braces and quotes are the least readable way to show
 * one; its fields, read down the page, are the most — and the entity it names is the one the reader
 * most wants to open, so its id and name carry the link to it.
 */
function jsonView(payload: JsonPayload, link: Linker): ResultView {
  const record = displayTableFromRecords([payload.value]);
  if (record === null) {
    return {
      summary: payload.label,
      notices: [],
      body: (_width, theme) => jsonLines(payload.value, theme),
    };
  }
  const linked = linkTable(record, [payload.value], payload.noun ?? null, link);
  return {
    summary: payload.label,
    notices: [],
    body: (width, theme) => recordLines(linked, width, theme),
  };
}

export function resultView(payload: ToolPayload, link: Linker = PLAIN_LINKER): ResultView {
  switch (payload.kind) {
    case "list": {
      return listView(payload, link);
    }
    case "sections": {
      return sectionsView(payload, link);
    }
    case "dataset": {
      return datasetView(payload);
    }
    case "json": {
      return jsonView(payload, link);
    }
  }
}

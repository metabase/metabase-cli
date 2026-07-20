import type { ListEnvelope } from "./envelope";
import { formatModelTable, sqlCellText, type TableData, tableFromRecords } from "./table";

export interface DatasetColumn {
  name: string;
  base_type?: string | undefined;
  semantic_type?: string | null | undefined;
}

export interface ListPayload {
  kind: "list";
  noun: string;
  envelope: ListEnvelope<unknown>;
}

export interface PayloadSection {
  title: string;
  items: readonly unknown[];
  notice?: string | undefined;
}

export interface SectionsPayload {
  kind: "sections";
  noun: string;
  sections: PayloadSection[];
  notices: string[];
}

export interface DatasetPayload {
  kind: "dataset";
  columns: DatasetColumn[];
  rows: readonly unknown[][];
  returned: number;
  offset: number;
  continuation?: string | undefined;
}

export interface JsonPayload {
  kind: "json";
  label: string;
  // What the value is, when it is one entity: the TUI turns "collection" plus the record's id into
  // the address of the collection, which is the thing a reader wants next after a write.
  noun?: string | undefined;
  value: unknown;
}

export type ToolPayload = ListPayload | SectionsPayload | DatasetPayload | JsonPayload;

const PAYLOAD_KINDS = ["list", "sections", "dataset", "json"] as const;

export function isToolPayload(value: unknown): value is ToolPayload {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const { kind } = value;
  return PAYLOAD_KINDS.some((known) => known === kind);
}

function notice(text: string): string {
  return `[${text}]`;
}

/** The model reads types off the header, so the rows below need no per-cell type information. */
export function datasetModelTable(payload: DatasetPayload): TableData {
  return { columns: payload.columns.map(typedColumnLabel), rows: datasetRows(payload) };
}

/** A reader already knows what a column holds; the type annotations are noise on screen. */
export function datasetDisplayTable(payload: DatasetPayload): TableData {
  return { columns: payload.columns.map((column) => column.name), rows: datasetRows(payload) };
}

function datasetRows(payload: DatasetPayload): string[][] {
  return payload.rows.map((row) => row.map(sqlCellText));
}

function typedColumnLabel(column: DatasetColumn): string {
  const types = [column.base_type, column.semantic_type ?? undefined].filter(
    (type): type is string => type !== undefined,
  );
  if (types.length === 0) {
    return column.name;
  }
  return `${column.name} (${types.join(", ")})`;
}

export function listTable(payload: ListPayload): TableData | null {
  return tableFromRecords(payload.envelope.data);
}

function listText(payload: ListPayload): string {
  const { data, returned, total, truncated } = payload.envelope;
  if (returned === 0) {
    return `No ${payload.noun} found.`;
  }
  const table = listTable(payload);
  const body = table === null ? JSON.stringify(data) : formatModelTable(table);
  const footer = truncated?.message ?? `${returned} of ${total ?? returned} ${payload.noun}`;
  return `${body}\n\n${notice(footer)}`;
}

function sectionsText(payload: SectionsPayload): string {
  const blocks = payload.sections.map((section) => {
    const table = tableFromRecords(section.items);
    const body =
      section.items.length === 0
        ? `No ${payload.noun}.`
        : table === null
          ? JSON.stringify(section.items)
          : formatModelTable(table);
    const trailer = section.notice === undefined ? "" : `\n${notice(section.notice)}`;
    return `## ${section.title}\n${body}${trailer}`;
  });
  const notices = payload.notices.map((text) => notice(text));
  return [...blocks, ...notices].join("\n\n");
}

function datasetText(payload: DatasetPayload): string {
  if (payload.returned === 0) {
    return "Query returned no rows.";
  }
  const body = formatModelTable(datasetModelTable(payload));
  const window = `rows ${payload.offset + 1}-${payload.offset + payload.returned}`;
  const footer = payload.continuation === undefined ? window : `${window}. ${payload.continuation}`;
  return `${body}\n\n${notice(footer)}`;
}

/** The single projection of a payload into the model's context. */
export function payloadText(payload: ToolPayload): string {
  switch (payload.kind) {
    case "list": {
      return listText(payload);
    }
    case "sections": {
      return sectionsText(payload);
    }
    case "dataset": {
      return datasetText(payload);
    }
    case "json": {
      return JSON.stringify(payload.value);
    }
  }
}

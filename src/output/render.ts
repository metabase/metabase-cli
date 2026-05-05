import type { ColumnDef, ResourceView } from "../domain/view";

import { capListEnvelope } from "./cap";
import { itemOversizeNotice, listTruncationNotice, warn } from "./notice";
import { applyProjection, isPlainObject } from "./projection";
import { formatCell, formatScalar, renderTable } from "./table";
import type { ListEnvelope, RenderOptions } from "./types";

type KeyValuePair = readonly [label: string, value: string];

export function renderItem<T>(item: T, view: ResourceView<T>, opts: RenderOptions): void {
  const projected = applyProjection(item, view, opts.full, opts.fields);
  const body = renderItemBody(item, view, projected, opts) + "\n";
  process.stdout.write(body);
  emitItemOversizeNotice(body, opts.maxBytes);
}

export function renderList<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  opts: RenderOptions,
): void {
  if (opts.format === "json" || opts.fields !== undefined) {
    renderJsonEnvelope(envelope, view, opts);
    return;
  }

  if (envelope.data.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }

  const capped = capListEnvelope(envelope, opts.maxBytes);
  process.stdout.write(renderTable(capped.data, view.tableColumns) + "\n");
  if (capped.truncated !== undefined) {
    warn(listTruncationNotice(capped.truncated.bytes));
  }
}

function renderJsonEnvelope<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  opts: RenderOptions,
): void {
  const projectedItems = envelope.data.map((item) =>
    applyProjection(item, view, opts.full, opts.fields),
  );
  const projectedEnvelope: ListEnvelope<unknown> = { ...envelope, data: projectedItems };
  const capped = capListEnvelope(projectedEnvelope, opts.maxBytes);
  process.stdout.write(JSON.stringify(capped, null, 2) + "\n");
  if (capped.truncated !== undefined) {
    warn(listTruncationNotice(capped.truncated.bytes));
  }
}

function renderItemBody<T>(
  item: T,
  view: ResourceView<T>,
  projected: unknown,
  opts: RenderOptions,
): string {
  if (opts.format === "json" || opts.fields !== undefined) {
    return JSON.stringify(projected, null, 2);
  }
  if (!opts.full) {
    return renderKeyValueLines(columnPairs(item, view.tableColumns));
  }
  return renderKeyValueLines(objectPairs(projected));
}

function columnPairs<T>(item: T, columns: ColumnDef<T>[]): KeyValuePair[] {
  return columns.map((column) => [column.label ?? column.key, formatCell(item, column)]);
}

function objectPairs(value: unknown): KeyValuePair[] {
  if (!isPlainObject(value)) {
    const scalar = formatScalar(value);
    return scalar === "" ? [] : [["", scalar]];
  }
  return Object.entries(value).map(([key, raw]) => [key, formatScalar(raw)]);
}

function renderKeyValueLines(pairs: ReadonlyArray<KeyValuePair>): string {
  if (pairs.length === 0) {
    return "";
  }
  const padding = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value]) => `${label.padEnd(padding)}  ${value}`).join("\n");
}

function emitItemOversizeNotice(body: string, maxBytes: number): void {
  if (maxBytes <= 0) {
    return;
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= maxBytes) {
    return;
  }
  warn(itemOversizeNotice(bytes));
}

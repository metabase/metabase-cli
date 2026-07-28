import { ConfigError } from "@metabase/client/errors";
import type { ColumnDef, ResourceView } from "./view";

import { type CapFit, capListEnvelope, fitWithinCap } from "./cap";
import { itemOversizeMessage, listTruncationNotice, warn } from "./notice";
import { applyProjection, isPlainObject, pickPath, projectForList } from "./projection";
import { formatCell, formatScalar, renderRows, renderTable } from "./table";
import type { ListEnvelope, RenderOptions } from "./types";

export { formatScalar } from "./table";

// Pretty-printing is pure token overhead for the machine consumers on the other side of a
// pipe (~40% of the bytes), so indentation is reserved for humans at a terminal.
export function serializeJson(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}

function stdoutPretty(): boolean {
  return process.stdout.isTTY === true;
}

export function jsonLine(value: unknown): string {
  return serializeJson(value, stdoutPretty()) + "\n";
}

export function writeJson(value: unknown): void {
  process.stdout.write(jsonLine(value));
}

export function writeText(text: string): void {
  process.stdout.write(text + "\n");
}

type KeyValuePair = readonly [label: string, value: string];

export function renderItem<T>(item: T, view: ResourceView<T>, opts: RenderOptions): void {
  const projected = applyProjection(item, view, opts.full, opts.fields);
  const body = renderItemBody(item, view, projected, opts) + "\n";
  assertItemWithinMaxBytes(body, opts);
  process.stdout.write(body);
}

// Default text/human view prints `summaryText` — a bare scalar for single-value lookups
// (setting get, git-sync is-dirty) so the result composes in a shell
// (`URL=$(mb … --format text)`), or an action-confirmation sentence for mutations
// ("Archived card 1 …"). `--json`, `--fields`, and `--full` fall through to renderItem, which
// emits structured JSON under `--json` and the selected/all fields as key/value lines in text.
// Pass a thunk when the text is expensive to build (e.g. a rendered result table) so it is
// skipped entirely under `--json`/`--fields`/`--full`.
export function renderSummary<T>(
  item: T,
  view: ResourceView<T>,
  summaryText: string | (() => string),
  opts: RenderOptions,
): void {
  if (opts.format === "json" || opts.fields !== undefined || opts.full) {
    renderItem(item, view, opts);
    return;
  }
  const body = (typeof summaryText === "function" ? summaryText() : summaryText) + "\n";
  assertItemWithinMaxBytes(body, opts);
  process.stdout.write(body);
}

export function renderList<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  opts: RenderOptions,
): void {
  if (opts.format === "json") {
    renderJsonEnvelope(envelope, view, opts);
    return;
  }

  if (envelope.data.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }

  if (opts.fields !== undefined) {
    renderProjectedTable(envelope, view, opts.fields, opts);
    return;
  }

  // The budget is spent on the projection, not on the raw `.loose()` item: a `Card` carries its
  // `dataset_query` and `result_metadata` into the cap while the table renders two columns of it.
  // Rows are then rendered from the raw items the cut kept, since the columns read the raw shape.
  const fit = fitWithinCap(projectedEnvelope(envelope, view, opts), opts.maxBytes);
  const kept = envelope.data.slice(0, fit.count);
  process.stdout.write(renderTable(kept, view.tableColumns) + "\n");
  warnIfCut(fit, envelope.offset, opts.oversizeHint);
}

// A window the cap emptied has no offset to resume from, so the notice reports the cut without
// one: the table prints its header and the remedy says how to ask for less.
function warnIfCut(fit: CapFit, offset: number, hint?: string): void {
  if (!fit.cut) {
    return;
  }
  warn(listTruncationNotice(fit.fullBytes, fit.count === 0 ? null : offset + fit.count, hint));
}

function renderProjectedTable<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  fields: string[],
  opts: RenderOptions,
): void {
  const projected = projectedEnvelope(envelope, view, opts);
  const fit = fitWithinCap(projected, opts.maxBytes);
  const rows = projected.data
    .slice(0, fit.count)
    .map((item) => fields.map((path) => formatScalar(pickPath(item, path.split(".")))));
  process.stdout.write(renderRows(fields, rows) + "\n");
  warnIfCut(fit, envelope.offset, opts.oversizeHint);
}

function projectedEnvelope<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  opts: RenderOptions,
): ListEnvelope<unknown> {
  return { ...envelope, data: envelope.data.map((item) => projectForList(item, view, opts)) };
}

function renderJsonEnvelope<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  opts: RenderOptions,
): void {
  const capped = capListEnvelope(projectedEnvelope(envelope, view, opts), opts.maxBytes);
  // Metadata precedes `data` so counts and the truncation marker survive when a downstream
  // consumer (an agent harness, a pager) cuts the tail of the output.
  const ordered: ListEnvelope<unknown> = {
    returned: capped.returned,
    offset: capped.offset,
    limit: capped.limit,
    total: capped.total,
    has_more: capped.has_more,
    next_offset: capped.next_offset,
    truncated: capped.truncated,
    data: capped.data,
  };
  process.stdout.write(serializeJson(ordered, stdoutPretty()) + "\n");
  if (capped.truncated !== undefined) {
    warn(listTruncationNotice(capped.truncated.bytes, capped.next_offset, opts.oversizeHint));
  }
}

function renderItemBody<T>(
  item: T,
  view: ResourceView<T>,
  projected: unknown,
  opts: RenderOptions,
): string {
  if (opts.format === "json") {
    return serializeJson(projected, stdoutPretty());
  }
  if (opts.fields !== undefined || opts.full) {
    return renderKeyValueLines(objectPairs(projected));
  }
  return renderKeyValueLines(columnPairs(item, view.tableColumns));
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

function assertItemWithinMaxBytes(body: string, opts: RenderOptions): void {
  if (opts.maxBytes <= 0) {
    return;
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= opts.maxBytes) {
    return;
  }
  throw new ConfigError(itemOversizeMessage(bytes, opts.maxBytes, opts.oversizeHint));
}

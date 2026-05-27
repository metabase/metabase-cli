import { ConfigError } from "../core/errors";
import type { ColumnDef, ResourceView } from "../domain/view";

import { capListEnvelope } from "./cap";
import { itemOversizeMessage, listTruncationNotice, warn } from "./notice";
import { applyProjection, isPlainObject, pickPath } from "./projection";
import { formatCell, formatScalar, renderRows, renderTable } from "./table";
import type { ListEnvelope, RenderOptions } from "./types";

export { formatScalar } from "./table";

export function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function writeText(text: string): void {
  process.stdout.write(text + "\n");
}

type KeyValuePair = readonly [label: string, value: string];

export function renderItem<T>(item: T, view: ResourceView<T>, opts: RenderOptions): void {
  const projected = applyProjection(item, view, opts.full, opts.fields);
  const body = renderItemBody(item, view, projected, opts) + "\n";
  assertItemWithinMaxBytes(body, opts.maxBytes);
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
  assertItemWithinMaxBytes(body, opts.maxBytes);
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
    renderProjectedTable(envelope, view, opts.fields, opts.maxBytes);
    return;
  }

  const capped = capListEnvelope(envelope, opts.maxBytes);
  process.stdout.write(renderTable(capped.data, view.tableColumns) + "\n");
  if (capped.truncated !== undefined) {
    warn(listTruncationNotice(capped.truncated.bytes));
  }
}

function renderProjectedTable<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  fields: string[],
  maxBytes: number,
): void {
  const projectedItems = projectListItems(envelope.data, view, false, fields);
  const capped = capListEnvelope({ ...envelope, data: projectedItems }, maxBytes);
  const rows = capped.data.map((item) =>
    fields.map((path) => formatScalar(pickPath(item, path.split(".")))),
  );
  process.stdout.write(renderRows(fields, rows) + "\n");
  if (capped.truncated !== undefined) {
    warn(listTruncationNotice(capped.truncated.bytes));
  }
}

// List projections are item-relative: each path is resolved against an element of `data`,
// not the envelope. Users who write the path they see in the JSON (`data.id`) hit a dead-end
// "unknown field path" error. Catch that here and point them at the item-relative form.
function projectListItems<T>(
  items: readonly T[],
  view: ResourceView<T>,
  full: boolean,
  fields: string[] | undefined,
): unknown[] {
  try {
    return items.map((item) => applyProjection(item, view, full, fields));
  } catch (error) {
    throw enrichListFieldPathError(error, fields);
  }
}

function enrichListFieldPathError(error: unknown, fields: string[] | undefined): unknown {
  if (
    fields === undefined ||
    !(error instanceof ConfigError) ||
    !error.message.startsWith("unknown field path")
  ) {
    return error;
  }
  const prefix = "data.";
  const culprit = fields.find((field) => field === "data" || field.startsWith(prefix));
  if (culprit === undefined) {
    return error;
  }
  const suggestion = culprit.startsWith(prefix) ? culprit.slice(prefix.length) : "<field>";
  return new ConfigError(
    `${error.message} — on list commands --fields paths are relative to each item in \`data\`, not the envelope. Drop the \`data.\` prefix (e.g. use \`${suggestion}\` instead of \`${culprit}\`).`,
  );
}

function renderJsonEnvelope<T>(
  envelope: ListEnvelope<T>,
  view: ResourceView<T>,
  opts: RenderOptions,
): void {
  const projectedItems = projectListItems(envelope.data, view, opts.full, opts.fields);
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
  if (opts.format === "json") {
    return JSON.stringify(projected, null, 2);
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

function assertItemWithinMaxBytes(body: string, maxBytes: number): void {
  if (maxBytes <= 0) {
    return;
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= maxBytes) {
    return;
  }
  throw new ConfigError(itemOversizeMessage(bytes, maxBytes));
}

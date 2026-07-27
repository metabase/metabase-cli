import { ConfigError } from "@metabase/client/errors";
import { isPlainObject } from "@metabase/client/predicates";

import type { RenderOptions } from "./types";
import type { ResourceView } from "./view";

// The single answer to "what does a list emit per item under these options", shared by the
// renderer and by the byte budget that decides how many items to fetch and keep. The default
// text table renders `tableColumns`, which `--full` does not widen, so its projection is the
// compact one; every other path projects what the flags asked for. Routing all of them through
// here is what keeps a text list and its `--json` equivalent cutting at the same row.
export function projectForList<T>(item: T, view: ResourceView<T>, opts: RenderOptions): unknown {
  const rendersTableColumns = opts.format === "text" && opts.fields === undefined;
  const full = rendersTableColumns ? false : opts.full;
  try {
    return applyProjection(item, view, full, opts.fields);
  } catch (error) {
    throw enrichListFieldPathError(error, opts.fields);
  }
}

// List projections are item-relative: each path is resolved against an element of `data`, not the
// envelope. Users who write the path they see in the JSON (`data.id`) hit a dead-end "unknown
// field path" error, so point them at the item-relative form.
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

export function applyProjection<T>(
  value: T,
  view: ResourceView<T>,
  full: boolean,
  fields: string[] | undefined,
): unknown {
  if (fields !== undefined) {
    if (fields.length === 0) {
      throw new ConfigError("--fields requires at least one path");
    }
    return projectFields(value, fields);
  }
  if (full) {
    return value;
  }
  const parsed = view.compactPick.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ConfigError(`compact projection failed: ${parsed.error.message}`);
}

function projectFields(value: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of fields) {
    if (path.length === 0) {
      throw new ConfigError(`empty field path`);
    }
    const parts = path.split(".");
    if (parts.some((part) => part.length === 0)) {
      throw new ConfigError(`invalid field path: "${path}"`);
    }
    setPath(out, parts, pickPath(value, parts));
  }
  return out;
}

export function pickPath(value: unknown, parts: string[]): unknown {
  let cursor: unknown = value;
  for (const part of parts) {
    if (!isPlainObject(cursor) || !Object.hasOwn(cursor, part)) {
      throw new ConfigError(`unknown field path: "${parts.join(".")}"`);
    }
    cursor = Reflect.get(cursor, part);
  }
  return cursor;
}

function setPath(target: Record<string, unknown>, parts: string[], value: unknown): void {
  let cursor = target;
  const lastIndex = parts.length - 1;
  for (const [index, part] of parts.entries()) {
    if (index === lastIndex) {
      cursor[part] = value;
      return;
    }
    const existing = cursor[part];
    if (isPlainObject(existing)) {
      cursor = existing;
    } else {
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
    }
  }
}

export { isPlainObject };

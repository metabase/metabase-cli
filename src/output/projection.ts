import { ConfigError } from "../core/errors";
import type { ResourceView } from "../domain/view";

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

function pickPath(value: unknown, parts: string[]): unknown {
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

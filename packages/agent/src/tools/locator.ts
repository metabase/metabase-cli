import { TeachingError } from "./teaching-error";

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const NANO_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;
const COLLECTION_TOKENS: ReadonlySet<string> = new Set(["root", "trash"]);

export type CollectionLocator = string | number;

export function resolveCollectionLocator(value: CollectionLocator): string {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) {
      return String(value);
    }
    throw new TeachingError(
      `Invalid collection id ${value} — pass a positive integer, an entity id, "root", or "trash".`,
    );
  }
  const trimmed = value.trim();
  if (COLLECTION_TOKENS.has(trimmed)) {
    return trimmed;
  }
  if (POSITIVE_INTEGER_PATTERN.test(trimmed) || NANO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  throw new TeachingError(
    `Invalid collection id ${JSON.stringify(value)} — pass a positive integer, a 21-char entity id, "root", or "trash".`,
  );
}

export function resolveNumericId(value: string | number, label: string): number {
  if (typeof value === "number") {
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    throw new TeachingError(`Invalid ${label} ${value} — pass a positive integer.`);
  }
  const trimmed = value.trim();
  if (POSITIVE_INTEGER_PATTERN.test(trimmed)) {
    return Number(trimmed);
  }
  throw new TeachingError(`Invalid ${label} ${JSON.stringify(value)} — pass a positive integer.`);
}

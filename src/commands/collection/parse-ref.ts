import { ConfigError } from "../../core/errors";

const SPECIAL_TOKENS: ReadonlySet<string> = new Set(["root", "trash"]);
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const NANO_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

const FORMAT_HINT = 'expected integer, "root", "trash", or 21-char entity id';

export function parseCollectionRef(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new ConfigError(`invalid id: ${JSON.stringify(trimmed)} (${FORMAT_HINT})`);
  }
  if (SPECIAL_TOKENS.has(trimmed)) {
    return trimmed;
  }
  if (POSITIVE_INTEGER_PATTERN.test(trimmed) || NANO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  throw new ConfigError(`invalid id: ${JSON.stringify(raw)} (${FORMAT_HINT})`);
}

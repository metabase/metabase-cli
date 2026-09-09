import { ConfigError } from "@metabase/client/errors";

// The only alias the content endpoints scope to a worktree; `trash` has no worktree counterpart.
export const COLLECTION_ROOT_REF = "root";

const SPECIAL_TOKENS: ReadonlySet<string> = new Set([COLLECTION_ROOT_REF, "trash"]);
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const NANO_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

const FORMAT_HINT = 'expected integer, "root", "trash", or 21-char entity id';

// An alias names a pseudo-collection the server assembles rather than a row, so it carries no
// worktree tag to compare a scope against.
export function isCollectionAlias(ref: string): boolean {
  return SPECIAL_TOKENS.has(ref);
}

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

import type { UUID } from "node:crypto";

const SLUG_WORD_LIMIT = 5;
const SLUG_LENGTH_LIMIT = 48;
const SLUG_FALLBACK = "session";
const SLUG_SEPARATOR = "-";
const FIRST_DUPLICATE_SUFFIX = 2;

const TITLE_LENGTH_LIMIT = 72;
const TITLE_FALLBACK = "Untitled session";
const ELLIPSIS = "…";

const NON_SLUG = /[^a-z0-9]+/;
const TRAILING_SEPARATORS = /-+$/;
const WHITESPACE = /\s+/;

export const BRANCH_PREFIX = "rde/";

export const MESSAGE_ID_PREFIX = "msg_";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isUuid(value: string): value is UUID {
  return UUID_PATTERN.test(value);
}

export function promptIdOf(messageId: string): UUID | null {
  if (!messageId.startsWith(MESSAGE_ID_PREFIX)) {
    return null;
  }
  const candidate = messageId.slice(MESSAGE_ID_PREFIX.length);
  return isUuid(candidate) ? candidate : null;
}

export function branchSlug(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .split(NON_SLUG)
    .filter((word) => word.length > 0)
    .slice(0, SLUG_WORD_LIMIT);
  const slug = words
    .join(SLUG_SEPARATOR)
    .slice(0, SLUG_LENGTH_LIMIT)
    .replace(TRAILING_SEPARATORS, "");
  return slug.length > 0 ? slug : SLUG_FALLBACK;
}

export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) {
    return slug;
  }
  let suffix = FIRST_DUPLICATE_SUFFIX;
  while (taken.has(`${slug}${SLUG_SEPARATOR}${suffix}`)) {
    suffix += 1;
  }
  return `${slug}${SLUG_SEPARATOR}${suffix}`;
}

export function branchName(slug: string): string {
  return `${BRANCH_PREFIX}${slug}`;
}

export function slugOfBranch(branch: string): string | null {
  return branch.startsWith(BRANCH_PREFIX) ? branch.slice(BRANCH_PREFIX.length) : null;
}

export function sessionTitle(prompt: string): string {
  const collapsed = prompt.trim().split(WHITESPACE).join(" ");
  if (collapsed.length === 0) {
    return TITLE_FALLBACK;
  }
  if (collapsed.length <= TITLE_LENGTH_LIMIT) {
    return collapsed;
  }
  // Cutting mid-word reads as a typo, so the title ends on the last whole word that fits.
  const cut = collapsed.slice(0, TITLE_LENGTH_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}${ELLIPSIS}`;
}

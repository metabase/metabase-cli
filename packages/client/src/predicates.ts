export function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Metabase's non-blank check is Clojure's `str/blank?`, i.e. Java's `Character.isWhitespace`, which
// counts U+001C-U+001F as whitespace and the no-break spaces (U+00A0, U+2007, U+202F) and U+FEFF
// as text. `String.prototype.trim` disagrees on all of them, so it cannot stand in.
const JAVA_WHITESPACE =
  "\t\n\v\f\r\u001C\u001D\u001E\u001F \u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200A\u2028\u2029\u205F\u3000";

const UNICODE_ESCAPE_DIGITS = 4;

function unicodeEscape(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(UNICODE_ESCAPE_DIGITS, "0")}`;
}

// Escaped, so the pattern reads plainly where it is shown, as in an input's JSON Schema.
const JAVA_WHITESPACE_ESCAPED = [...JAVA_WHITESPACE].map(unicodeEscape).join("");

/** Matches a string Metabase reads as not blank: one holding a character that is not Java whitespace. */
export const NOT_BLANK = new RegExp(`[^${JAVA_WHITESPACE_ESCAPED}]`);

/** Whether Metabase reads `value` as blank: empty, or Java whitespace only. */
export function isBlank(value: string): boolean {
  return !NOT_BLANK.test(value);
}

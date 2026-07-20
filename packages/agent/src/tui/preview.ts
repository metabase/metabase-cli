import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { GLYPH } from "./glyphs";

/**
 * Every collapse budget in the TUI, in one table: a transcript whose blocks each truncate at their
 * own threshold reads as an accident rather than a decision.
 */
export const PREVIEW = {
  collapsedLines: 8,
  expandedLines: 60,
  collapsedCodeLines: 6,
} as const;

function moreLine(hidden: number, theme: Theme): string {
  const noun = hidden === 1 ? "line" : "lines";
  const count = theme.fg("muted", `${GLYPH.ellipsis} ${hidden} more ${noun}`);
  return `${count} ${keyHint("app.tools.expand", "to expand")}`;
}

/**
 * Keeps the head, and says what it kept back. A tool result is a table or a document — its first
 * rows are the sample the reader came for, and the tail is the part they scroll to only when the
 * head was not enough. A block cut without the count reads as the whole thing.
 */
export function capLines(lines: readonly string[], limit: number, theme: Theme): string[] {
  if (lines.length <= limit) {
    return [...lines];
  }
  return [...lines.slice(0, limit), moreLine(lines.length - limit, theme)];
}

export function bodyLimit(expanded: boolean): number {
  return expanded ? PREVIEW.expandedLines : PREVIEW.collapsedLines;
}

export function codeLimit(expanded: boolean): number {
  return expanded ? PREVIEW.expandedLines : PREVIEW.collapsedCodeLines;
}

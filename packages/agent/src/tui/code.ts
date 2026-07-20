import { highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { capLines, codeLimit } from "./preview";

const JSON_INDENT = 2;

export interface CodeBody {
  language: string;
  text: string;
}

type LineSource = (width: number) => string[];

/**
 * pi's component contract is `render(width) => lines`, and it is strict: a single line wider than
 * the terminal takes the whole TUI down with an uncaught exception. Wrapping here is what makes that
 * unreachable — a Metabase error message, a JSON payload and a highlighted query all arrive as text
 * that knows nothing about the width it will be drawn at, and any one of them can be long.
 */
export class Lines implements Component {
  private readonly source: LineSource;

  constructor(source: LineSource) {
    this.source = source;
  }

  render(width: number): string[] {
    return this.source(width).flatMap((line) => wrapTextWithAnsi(line, width));
  }

  invalidate(): void {}
}

export function codeLines(body: CodeBody, expanded: boolean, theme: Theme): string[] {
  return capLines(highlightCode(body.text, body.language), codeLimit(expanded), theme);
}

/**
 * A query the model minifies onto one line is one line to every budget that counts lines — nothing
 * collapses it, so it wraps across the terminal in full. Indented, it is both readable and capped.
 */
export function indentJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, JSON_INDENT);
  } catch {
    return null;
  }
}

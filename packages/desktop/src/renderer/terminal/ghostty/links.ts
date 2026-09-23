/**
 * Only URLs are links here: a click hands one to the browser, and a path would
 * need the editor rather than a browser to mean anything.
 */

export interface TerminalLinkMatch {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** One viewport row as the link scanner reads it. */
export interface TerminalBufferLineLike {
  readonly isWrapped?: boolean;
  translateToString(trimRight?: boolean): string;
}

interface WrappedTerminalLinkLineSegment {
  readonly bufferLineNumber: number;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface WrappedTerminalLinkLine {
  readonly text: string;
  readonly segments: readonly WrappedTerminalLinkLineSegment[];
}

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/giu;
const TRAILING_PUNCTUATION_PATTERN = /[.,;!?]+$/;

/**
 * Sentence punctuation and unbalanced closers belong to the prose around a
 * URL, not to the URL: `see https://x/y.` and `(https://x/y)` both end at `y`.
 */
function trimClosingDelimiters(value: string): string {
  let output = value.replace(TRAILING_PUNCTUATION_PATTERN, "");
  if (output.length === 0) {
    return output;
  }

  const trimUnbalanced = (open: string, close: string): void => {
    while (output.endsWith(close)) {
      const opens = output.split(open).length - 1;
      const closes = output.split(close).length - 1;
      if (opens >= closes) {
        return;
      }
      output = output.slice(0, -1);
    }
  };

  trimUnbalanced("(", ")");
  trimUnbalanced("[", "]");
  trimUnbalanced("{", "}");
  return output;
}

/** Every URL in one logical (soft-wrap joined) line, in reading order. */
export function extractTerminalLinks(line: string): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = [];
  URL_PATTERN.lastIndex = 0;
  for (const rawMatch of line.matchAll(URL_PATTERN)) {
    const raw = rawMatch[0];
    const start = rawMatch.index;
    if (start === undefined || raw.length === 0) {
      continue;
    }
    const trimmed = trimClosingDelimiters(raw);
    if (trimmed.length === 0) {
      continue;
    }
    matches.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return matches;
}

/**
 * The whole soft-wrapped line the given row belongs to, as one string plus
 * the per-row segments that map an offset in it back to a row and column.
 */
export function collectWrappedTerminalLinkLine(
  bufferLineNumber: number,
  getLine: (bufferLineIndex: number) => TerminalBufferLineLike | null | undefined,
): WrappedTerminalLinkLine | null {
  const anchorLine = getLine(bufferLineNumber - 1);
  if (!anchorLine) {
    return null;
  }

  let startBufferLineNumber = bufferLineNumber;
  let startLine = anchorLine;

  while (startBufferLineNumber > 1 && startLine.isWrapped) {
    const previousLine = getLine(startBufferLineNumber - 2);
    if (!previousLine) {
      return null;
    }
    startBufferLineNumber -= 1;
    startLine = previousLine;
  }

  const segments: WrappedTerminalLinkLineSegment[] = [];
  let nextStartIndex = 0;
  let currentBufferLineNumber = startBufferLineNumber;

  while (true) {
    const currentLine = getLine(currentBufferLineNumber - 1);
    if (!currentLine) {
      break;
    }

    const nextLine = getLine(currentBufferLineNumber);
    const hasWrappedContinuation = nextLine?.isWrapped === true;
    const text = currentLine.translateToString(!hasWrappedContinuation);

    segments.push({
      bufferLineNumber: currentBufferLineNumber,
      text,
      startIndex: nextStartIndex,
      endIndex: nextStartIndex + text.length,
    });
    nextStartIndex += text.length;

    if (!hasWrappedContinuation) {
      break;
    }
    currentBufferLineNumber += 1;
  }

  return {
    text: segments.map((segment) => segment.text).join(""),
    segments,
  };
}

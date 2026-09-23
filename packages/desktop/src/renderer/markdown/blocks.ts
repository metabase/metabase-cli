export interface MarkdownBlocks {
  readonly stable: readonly string[];
  readonly tail: string;
}

const LINE_SEPARATOR = "\n";

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^ {4,}\S/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d+[.)])\s/;
const BLOCK_QUOTE = /^ {0,3}>/;

interface OpenFence {
  readonly marker: string;
  readonly length: number;
}

function openingFence(line: string): OpenFence | null {
  const found = FENCE_OPEN.exec(line);
  const run = found?.[1];
  if (run === undefined) {
    return null;
  }
  return { marker: run.slice(0, 1), length: run.length };
}

const MAX_FENCE_INDENT = 3;

// CommonMark closes a fence with at least as many of the same character and nothing else after it.
function closesFence(line: string, fence: OpenFence): boolean {
  const squared = line.trimEnd();
  const body = squared.trimStart();
  if (squared.length - body.length > MAX_FENCE_INDENT || body.length < fence.length) {
    return false;
  }
  return [...body].every((character) => character === fence.marker);
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

// A half-typed last line would decide a cut that moves once the rest arrives.
function settledContentLine(lines: readonly string[], from: number, end: number): string | null {
  for (let index = from; index < end; index += 1) {
    const line = lines[index];
    if (line !== undefined && !isBlank(line)) {
      return line;
    }
  }
  return null;
}

function lastContentLine(block: readonly string[]): string | null {
  for (let index = block.length - 1; index >= 0; index -= 1) {
    const line = block[index];
    if (line !== undefined && !isBlank(line)) {
      return line;
    }
  }
  return null;
}

// A blank line only ends a block when the two sides are not one construct written loosely: an
// indented code block, a list whose items breathe, or a quote carried over a gap.
function cuts(block: readonly string[], next: string): boolean {
  if (INDENTED_CODE.test(next)) {
    return false;
  }
  const previous = lastContentLine(block);
  if (previous === null) {
    return false;
  }
  if (LIST_ITEM.test(previous) && LIST_ITEM.test(next)) {
    return false;
  }
  return !(BLOCK_QUOTE.test(previous) && BLOCK_QUOTE.test(next));
}

export type MessageState = "streaming" | "settled";

export function splitBlocks(source: string, state: MessageState): MarkdownBlocks {
  const lines = source.split(LINE_SEPARATOR);
  const settledThrough = state === "streaming" ? lines.length - 1 : lines.length;
  const stable: string[] = [];
  let block: string[] = [];
  let fence: OpenFence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    if (fence !== null) {
      block.push(line);
      if (closesFence(line, fence)) {
        fence = null;
      }
      continue;
    }
    const opened = openingFence(line);
    if (opened !== null) {
      block.push(line);
      fence = opened;
      continue;
    }
    if (!isBlank(line)) {
      block.push(line);
      continue;
    }
    const next = settledContentLine(lines, index + 1, settledThrough);
    if (block.length === 0 || next === null || !cuts(block, next)) {
      if (block.length > 0) {
        block.push(line);
      }
      continue;
    }
    stable.push(block.join(LINE_SEPARATOR));
    block = [];
  }

  return { stable, tail: block.join(LINE_SEPARATOR) };
}

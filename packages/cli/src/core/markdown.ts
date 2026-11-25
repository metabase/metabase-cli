import { ConfigError } from "@metabase/client/errors";

const FRONTMATTER_FENCE = "---";
const FENCE_RUN = /^(?:`{3,}|~{3,})/;

interface SplitFrontmatter {
  yaml: string;
  body: string;
  // Where the body starts in the file, counted from 1.
  bodyLine: number;
}

export function splitFrontmatter(content: string, source: string): SplitFrontmatter {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(FRONTMATTER_FENCE)) {
    throw new ConfigError(`${source}: missing frontmatter`);
  }
  const afterOpening = trimmed.slice(FRONTMATTER_FENCE.length);
  const closingIndex = afterOpening.indexOf(`\n${FRONTMATTER_FENCE}`);
  if (closingIndex < 0) {
    throw new ConfigError(`${source}: unterminated frontmatter`);
  }
  const closingLine = afterOpening.slice(closingIndex + 1);
  const lineEnd = closingLine.indexOf("\n");
  const body = lineEnd < 0 ? "" : closingLine.slice(lineEnd + 1);
  const beforeBody = content.slice(0, content.length - body.length);
  return {
    yaml: afterOpening.slice(0, closingIndex),
    body,
    bodyLine: beforeBody.split("\n").length,
  };
}

// `fence` is the line that opens or closes a fenced code block, and `code` a line inside one.
type LinePlace = "prose" | "fence" | "code";

export interface MarkdownLine {
  lineNumber: number;
  text: string;
  place: LinePlace;
}

export function readMarkdownLines(text: string, firstLine = 1): MarkdownLine[] {
  let fence: string | null = null;
  return text.split("\n").map((line, index) => {
    const read = readLine(line.trim(), fence);
    fence = read.fence;
    return { lineNumber: firstLine + index, text: line, place: read.place };
  });
}

interface LineRead {
  place: LinePlace;
  // The fence still open after the line.
  fence: string | null;
}

function readLine(trimmed: string, fence: string | null): LineRead {
  if (fence === null) {
    const opening = fenceRun(trimmed);
    return { place: opening === null ? "prose" : "fence", fence: opening };
  }
  return closesFence(trimmed, fence) ? { place: "fence", fence: null } : { place: "code", fence };
}

// The backtick or tilde run that opens a fenced code block, or `null` for any other line.
function fenceRun(trimmed: string): string | null {
  const match = FENCE_RUN.exec(trimmed);
  return match === null ? null : match[0];
}

// A closing fence is the opening run's character, at least as long, and nothing else on the line.
function closesFence(trimmed: string, fence: string): boolean {
  const run = fenceRun(trimmed);
  return run !== null && run.startsWith(fence) && run === trimmed;
}

export interface CodeBlock {
  // The first word after the opening fence, or `null` when there is none.
  language: string | null;
  // The line the block's text starts on.
  firstLine: number;
  text: string;
}

export function codeBlocks(lines: readonly MarkdownLine[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  let opening: MarkdownLine | null = null;
  let code: string[] = [];
  for (const line of lines) {
    if (line.place === "code") {
      code.push(line.text);
      continue;
    }
    if (line.place !== "fence") {
      continue;
    }
    if (opening === null) {
      opening = line;
      code = [];
      continue;
    }
    blocks.push(codeBlock(opening, code));
    opening = null;
  }
  if (opening !== null) {
    blocks.push(codeBlock(opening, code));
  }
  return blocks;
}

function codeBlock(opening: MarkdownLine, code: readonly string[]): CodeBlock {
  const info = opening.text.trim().replace(FENCE_RUN, "").trim();
  return {
    language: info === "" ? null : (info.split(/\s+/)[0] ?? null),
    firstLine: opening.lineNumber + 1,
    text: code.join("\n"),
  };
}

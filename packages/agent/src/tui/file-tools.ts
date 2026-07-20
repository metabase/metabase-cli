import {
  type AgentToolResult,
  createWriteToolDefinition,
  getLanguageFromPath,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { codeLines, indentJson, Lines } from "./code";
import { GLYPH } from "./glyphs";
import { formatStatusLine, type StatusTone } from "./status-line";
import type { ToolCallView } from "./tool-call";

const PLAIN_TEXT = "text";

const WriteArgs = z
  .object({
    path: z.string(),
    file_path: z.string(),
    content: z.string(),
  })
  .partial()
  .loose();

type WriteRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];

function tone(context: WriteRenderContext): StatusTone {
  if (context.isError) {
    return "error";
  }
  return context.isPartial ? "running" : "done";
}

/** The reader knows where the session is rooted; the part of the path they don't know is the file. */
function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) {
    return path;
  }
  const inside = relative(cwd, path);
  return inside.startsWith("..") ? path : inside;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/**
 * A write is the one call whose whole point is the body — the query the model is about to hand to
 * Metabase. It gets the same header as every Metabase call, over the body it is writing: indented if
 * it is JSON, highlighted for its language, and capped like every other code block in the transcript.
 */
export function writeCallView(args: unknown, cwd: string): ToolCallView {
  const parsed = WriteArgs.safeParse(args);
  const line = { icon: GLYPH.write, title: "Write file" };
  if (!parsed.success) {
    return { line };
  }

  const path = parsed.data.file_path ?? parsed.data.path;
  if (path === undefined) {
    return { line };
  }
  const detail = displayPath(path, cwd);

  const content = parsed.data.content;
  if (content === undefined) {
    return { line: { ...line, detail } };
  }
  const body = {
    language: getLanguageFromPath(path) ?? PLAIN_TEXT,
    text: indentJson(content) ?? content,
  };
  return {
    line: { ...line, detail, meta: [count(body.text.split("\n").length, "line")] },
    body,
  };
}

/** The write already showed what it was writing; its answer is one line, or the reason it failed. */
function resultLines(
  result: AgentToolResult<unknown>,
  theme: Theme,
  context: WriteRenderContext,
): string[] {
  const text = result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((part) => part !== "")
    .join("\n");
  const color = context.isError ? "error" : "muted";
  return text.split("\n").map((line) => theme.fg(color, line));
}

/**
 * The model authors its query, layout and document bodies as files, so pi's file tools sit between
 * the Metabase calls in the same transcript. Their execution is pi's; only their rendering is ours,
 * and a tool of the same name replaces the builtin's definition — including its renderers.
 */
export function fileToolRenderers(cwd: string): ToolDefinition[] {
  const write = createWriteToolDefinition(cwd);
  const rendered: ToolDefinition = {
    ...write,
    renderCall: (args, theme, context) => {
      const view = writeCallView(args, cwd);
      const header = formatStatusLine(view.line, tone(context), theme);
      const body = view.body;
      if (body === undefined || !context.argsComplete) {
        return new Lines(() => [header]);
      }
      return new Lines(() => [header, ...codeLines(body, context.expanded, theme)]);
    },
    renderResult: (result, _options, theme, context) =>
      new Lines(() => resultLines(result, theme, context)),
  };
  return [rendered];
}

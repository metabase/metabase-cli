import {
  type AgentToolResult,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { isToolPayload } from "../tools/payload";
import { codeLines, Lines } from "./code";
import { formatDuration } from "./duration";
import { GLYPH, SEPARATOR } from "./glyphs";
import { createLinker, type Linker } from "./link";
import { bodyLimit, capLines } from "./preview";
import { resultView } from "./result-view";
import { formatStatusLine, type StatusTone } from "./status-line";
import { toolCallView } from "./tool-call";

const TICK_MS = 1000;
const ELAPSED_FLOOR_MS = 1000;

interface RenderState {
  startedAt?: number | undefined;
  endedAt?: number | undefined;
  ticker?: NodeJS.Timeout | undefined;
}

type MetabaseToolDefinition = ToolDefinition<ToolDefinition["parameters"], unknown, RenderState>;
type RenderContext = Parameters<NonNullable<MetabaseToolDefinition["renderCall"]>>[2];

function tone(context: RenderContext): StatusTone {
  if (context.isError) {
    return "error";
  }
  return context.isPartial ? "running" : "done";
}

function renderCall(
  tool: ToolDefinition,
  args: unknown,
  theme: Theme,
  context: RenderContext,
  link: Linker,
) {
  const view = toolCallView(tool.name, tool.label, args, link);
  const header = formatStatusLine(view.line, tone(context), theme);
  const body = view.body;
  if (body === undefined || !context.argsComplete) {
    return new Lines(() => [header]);
  }
  return new Lines(() => [header, ...codeLines(body, context.expanded, theme)]);
}

/**
 * A tool that has been running for under a second has no elapsed time worth reading — the number
 * would be noise on every row, and the rows that matter are the ones that took a while.
 */
function elapsed(state: RenderState): string[] {
  if (state.startedAt === undefined) {
    return [];
  }
  const ms = (state.endedAt ?? Date.now()) - state.startedAt;
  return ms < ELAPSED_FLOOR_MS ? [] : [formatDuration(ms)];
}

/** The elapsed time on a running tool only advances if something asks for a repaint. */
function trackTiming(state: RenderState, options: ToolRenderResultOptions, context: RenderContext) {
  if (state.startedAt === undefined) {
    state.startedAt = Date.now();
  }
  const settled = !options.isPartial || context.isError;
  if (settled) {
    state.endedAt ??= Date.now();
    if (state.ticker !== undefined) {
      clearInterval(state.ticker);
      state.ticker = undefined;
    }
    return;
  }
  state.ticker ??= setInterval(() => context.invalidate(), TICK_MS);
}

function errorText(result: AgentToolResult<unknown>, theme: Theme): string[] {
  const message = result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text !== "")
    .join("\n");
  return message
    .split("\n")
    .map((line, index) =>
      index === 0 ? theme.fg("error", `${GLYPH.failed} ${line}`) : theme.fg("error", line),
    );
}

function renderResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: RenderContext,
  link: Linker,
) {
  trackTiming(context.state, options, context);

  if (!isToolPayload(result.details)) {
    return new Lines(() => errorText(result, theme));
  }

  const view = resultView(result.details, link);
  const timing = elapsed(context.state);
  const summary = [view.summary, ...timing].join(SEPARATOR);

  return new Lines((width) => {
    const lines = [theme.fg("muted", summary)];
    lines.push(...capLines(view.body(width, theme), bodyLimit(context.expanded), theme));
    for (const notice of view.notices) {
      lines.push(theme.fg("warning", notice));
    }
    return lines;
  });
}

/**
 * Every Metabase tool renders from its arguments and its `details` payload, so the terminal never
 * shows the model-facing text and the model never pays for the terminal's alignment. The ids in both
 * are addresses on `instanceUrl`, and a terminal that speaks OSC 8 makes them clickable.
 */
export function withRenderers(tool: ToolDefinition, instanceUrl: string | null): ToolDefinition {
  const link = createLinker(instanceUrl);
  const rendered: MetabaseToolDefinition = {
    ...tool,
    renderCall: (args, theme, context) => renderCall(tool, args, theme, context, link),
    renderResult: (result, options, theme, context) =>
      renderResult(result, options, theme, context, link),
  };
  return rendered;
}

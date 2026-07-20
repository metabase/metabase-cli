import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { SEPARATOR } from "./glyphs";

/**
 * One grammar for every tool header in the TUI:
 *
 *     {icon} {Title} {detail} · {meta} · {meta}
 *
 * The title says what the tool is doing, the detail names the thing it is doing it to, and the
 * meta carries the modifiers nobody reads unless they are looking for them.
 */
export interface StatusLine {
  icon: string;
  title: string;
  detail?: string | undefined;
  meta?: readonly string[] | undefined;
}

export type StatusTone = "running" | "done" | "error";

const TONE: Record<StatusTone, ThemeColor> = {
  running: "accent",
  done: "toolTitle",
  error: "error",
};

/** A header is one row. A detail carrying a newline would silently make it two. */
function flatten(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

export function formatStatusLine(line: StatusLine, tone: StatusTone, theme: Theme): string {
  const head = theme.fg(TONE[tone], theme.bold(`${line.icon} ${flatten(line.title)}`));
  const parts = [head];
  if (line.detail !== undefined && line.detail !== "") {
    parts.push(theme.fg("text", flatten(line.detail)));
  }
  const meta = (line.meta ?? []).filter((entry) => entry !== "").map(flatten);
  if (meta.length === 0) {
    return parts.join(" ");
  }
  return `${parts.join(" ")}${theme.fg("dim", SEPARATOR + meta.join(SEPARATOR))}`;
}

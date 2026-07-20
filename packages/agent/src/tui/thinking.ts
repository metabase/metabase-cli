import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const LABEL = "Thinking";
const SUMMARY_MAX = 64;
const SENTENCE_END = /(?<=[.:?!])\s/;
const BOLD_TITLE = /^\s*\*\*(?<title>[^*]+)\*\*/;
const MARKDOWN_NOISE = /[*_`#>]/g;

/**
 * The first thing a reasoning block says is what it has decided to do about the request — which is
 * the one line of it a reader wants. Everything after is the model working, and it belongs behind
 * the toggle.
 */
export function thinkingSummary(text: string): string | null {
  const title = BOLD_TITLE.exec(text)?.groups?.["title"];
  const source = title ?? text.split(SENTENCE_END)[0] ?? "";
  const summary = source.replaceAll(MARKDOWN_NOISE, "").replaceAll(/\s+/g, " ").trim();
  if (summary === "") {
    return null;
  }
  return summary.length <= SUMMARY_MAX ? summary : `${summary.slice(0, SUMMARY_MAX - 1)}…`;
}

export interface ThinkingStatus {
  /** Forget the reasoning seen so far: the block it summarized is over. */
  reset(): void;
  /** The status the arrived reasoning now warrants, or `null` while it warrants no new one. */
  advance(delta: string): string | null;
}

export function thinkingStatus(): ThinkingStatus {
  let thinking = "";
  let shown: string | null = null;

  return {
    reset(): void {
      thinking = "";
      shown = null;
    },
    advance(delta: string): string | null {
      thinking += delta;
      const summary = thinkingSummary(thinking);
      if (summary === null || summary === shown) {
        return null;
      }
      shown = summary;
      return `${LABEL}: ${summary}`;
    },
  };
}

/**
 * pi collapses a reasoning block to a single line, which reads "Thinking..." — an admission that
 * something is happening. Naming what the model is reasoning about turns that into a trace worth
 * glancing at, and it costs one status line. Ctrl-T still opens the block itself.
 *
 * The summary goes to the working status, not to the collapsed block's label: that label is one
 * string for the whole transcript, so writing a summary there stamps it onto every reasoning block
 * on screen, describing blocks it has never read. The status line is the surface that is meant to
 * be transient — it says what is happening now, and nothing is claimed about what already happened.
 */
export function metabaseThinkingExtension() {
  return (pi: ExtensionAPI): void => {
    const status = thinkingStatus();

    const clear = (ctx: ExtensionContext): void => {
      status.reset();
      ctx.ui.setWorkingMessage();
    };

    pi.on("message_start", (_event, ctx) => {
      if (ctx.mode === "tui") {
        clear(ctx);
      }
    });

    pi.on("message_end", (_event, ctx) => {
      if (ctx.mode === "tui") {
        clear(ctx);
      }
    });

    pi.on("message_update", (event, ctx) => {
      if (ctx.mode !== "tui" || event.assistantMessageEvent.type !== "thinking_delta") {
        return;
      }
      const next = status.advance(event.assistantMessageEvent.delta);
      if (next !== null) {
        ctx.ui.setWorkingMessage(next);
      }
    });
  };
}

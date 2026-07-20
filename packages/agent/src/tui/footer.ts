import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { MetabaseAccess } from "../metabase/access";
import { SEPARATOR } from "./glyphs";

const SIGNED_OUT = "not signed in";
const NO_MODEL = "no model";
const TOKEN_UNIT = 1000;
const COST_PRECISION = 3;
const CONTEXT_PRECISION = 1;
const CONTEXT_WARNING_PERCENT = 70;
const CONTEXT_ERROR_PERCENT = 90;

export interface FooterOptions {
  access: MetabaseAccess;
}

interface Usage {
  input: number;
  output: number;
  cost: number;
}

function formatTokens(value: number): string {
  if (value < TOKEN_UNIT) {
    return String(value);
  }
  return `${(value / TOKEN_UNIT).toFixed(1)}k`;
}

function sessionUsage(ctx: ExtensionContext): Usage {
  const usage: Usage = { input: 0, output: 0, cost: 0 };
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    usage.input += entry.message.usage.input;
    usage.output += entry.message.usage.output;
    usage.cost += entry.message.usage.cost.total;
  }
  return usage;
}

function contextColor(percent: number): ThemeColor {
  if (percent > CONTEXT_ERROR_PERCENT) {
    return "error";
  }
  return percent > CONTEXT_WARNING_PERCENT ? "warning" : "dim";
}

/** Absent until the first assistant reply lands, and again for the turn after a compaction. */
function contextUsage(ctx: ExtensionContext, theme: Theme): string | null {
  const usage = ctx.getContextUsage();
  if (usage === undefined || usage.percent === null) {
    return null;
  }
  const text = `${usage.percent.toFixed(CONTEXT_PRECISION)}% of ${formatTokens(usage.contextWindow)}`;
  return theme.fg(contextColor(usage.percent), text);
}

/** A session that has spent nothing has nothing to report, and a row of zeroes is worse than a blank. */
function spend(ctx: ExtensionContext, theme: Theme): string {
  const usage = sessionUsage(ctx);
  if (usage.input === 0 && usage.output === 0) {
    return "";
  }
  const parts = [
    `↑${formatTokens(usage.input)}`,
    `↓${formatTokens(usage.output)}`,
    `$${usage.cost.toFixed(COST_PRECISION)}`,
  ];
  const context = contextUsage(ctx, theme);
  const spent = theme.fg("dim", parts.join(" "));
  return context === null ? spent : `${spent}${theme.fg("dim", SEPARATOR)}${context}`;
}

/** Who the agent is acting as, which is the fact an operator most needs and pi's footer cannot know. */
function identity(access: MetabaseAccess, theme: Theme): string {
  const url = access.url();
  if (url === null) {
    return theme.fg("warning", SIGNED_OUT);
  }
  const user = access.instance().user;
  const parts = user === null ? [url] : [url, user.common_name];
  return theme.fg("dim", parts.join(SEPARATOR));
}

function engine(ctx: ExtensionContext, pi: ExtensionAPI, theme: Theme): string {
  const model = ctx.model?.id ?? NO_MODEL;
  const thinking = pi.getThinkingLevel();
  const parts = thinking === "off" ? [model] : [model, thinking];
  return theme.fg("dim", parts.join(SEPARATOR));
}

function justify(left: string, right: string, width: number): string {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap < 1) {
    return truncateToWidth(left, width);
  }
  return `${left}${" ".repeat(gap)}${right}`;
}

/**
 * pi's footer reports the cwd and its git branch. This agent's cwd is a scratch directory it made
 * itself, so those two facts describe nothing; the instance it is signed in to, and what the session
 * has spent, are the two an operator acts on.
 */
export function metabaseFooterExtension(options: FooterOptions) {
  return (pi: ExtensionAPI): void => {
    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui") {
        return;
      }
      ctx.ui.setFooter((_tui, theme) => ({
        render: (width: number) => [
          justify(identity(options.access, theme), engine(ctx, pi, theme), width),
          truncateToWidth(spend(ctx, theme), width),
        ],
        invalidate: () => {},
      }));
    });
  };
}

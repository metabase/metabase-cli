import {
  type ExtensionAPI,
  keyHint,
  keyText,
  rawKeyHint,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { displayUrl } from "@metabase/cli/url";
import type { MetabaseAccess } from "../metabase/access";
import type { InstanceContext } from "../metabase/probe";

const TITLE = "Metabase Agent";
const PITCH = "Ask about your data — explore it, query it, and save what you find.";
const SIGNED_OUT = "Not signed in — run /mb-login <url> to sign in through the browser.";
const SEPARATOR = " · ";

export interface HeaderOptions {
  access: MetabaseAccess;
}

// What the session is pointed at, read at render time: `/mb-login` can establish the instance while
// the header is already on screen.
export function instanceSummary(access: MetabaseAccess): string {
  const url = access.url();
  if (url === null) {
    return SIGNED_OUT;
  }
  const instance = access.instance();
  const user = instance.user;
  const who = user === null ? "" : ` as ${user.common_name}`;
  return `Connected to ${displayUrl(url)}${who}${build(instance)}`;
}

/** The build is a fact about the server, not about the person — it belongs in the parenthesis. */
function build(instance: InstanceContext): string {
  const facts = [instance.versionTag, instance.edition].filter((fact) => fact !== null);
  return facts.length === 0 ? "" : ` (${facts.join(" ")})`;
}

function hints(): string {
  return [
    rawKeyHint("/", "commands"),
    rawKeyHint("!", "run a shell command"),
    keyHint("app.interrupt", "stop"),
    rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
  ].join(SEPARATOR);
}

function lines(theme: Theme, access: MetabaseAccess): string[] {
  return [
    theme.bold(theme.fg("accent", TITLE)),
    theme.fg("text", instanceSummary(access)),
    theme.fg("dim", PITCH),
    "",
    hints(),
  ];
}

// pi's own header names pi, stamps pi's version and offers to explain pi — none of which describes
// this product, and its version is not one an operator of this agent can act on. `setHeader` is pi's
// sanctioned replacement, so the startup banner names the agent and the instance it reaches instead.
export function metabaseHeaderExtension(options: HeaderOptions) {
  return (pi: ExtensionAPI): void => {
    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui") {
        return;
      }
      // A line wider than the terminal is an uncaught exception in pi's renderer, and both the
      // instance URL and the operator's name are arbitrarily long.
      ctx.ui.setHeader((_tui, theme) => ({
        render: (width: number) =>
          lines(theme, options.access).flatMap((line) => wrapTextWithAnsi(line, width)),
        invalidate: () => {},
      }));
    });
  };
}

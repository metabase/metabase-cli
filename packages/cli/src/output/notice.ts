export function warn(message: string): void {
  process.stderr.write(message + "\n");
}

// What sending a call the client's own checks would have refused risks, said both where the flag is
// offered and where it was used.
const PREFLIGHT_RISK =
  "may ignore or rewrite what it does not support and answer without saying so";

export const PREFLIGHT_SKIP_REMEDY = `If this server does support it, rerun with --skip-preflight; a server without it ${PREFLIGHT_RISK}.`;

export function preflightSkippedNotice(refusal: string): string {
  return `Skipped preflight: ${withoutFinalPeriod(refusal)}. A server without it ${PREFLIGHT_RISK}.`;
}

export function preflightUncheckedNotice(reason: string): string {
  return `Skipped preflight: could not check the server (${withoutFinalPeriod(reason)}), so the request went out unchecked. A server without a feature it needs ${PREFLIGHT_RISK}.`;
}

function withoutFinalPeriod(text: string): string {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

const LIST_TRUNCATION_REMEDY = "narrow the selection or raise --max-bytes";

// A cut the cap could not make resumable still has a way out, and on the commands that know a
// better one than the generic advice — a whole-row read like `mb skills get` — that is the remedy
// worth printing.
export function listTruncationNotice(
  bytes: number,
  nextOffset?: number | null,
  hint?: string,
): string {
  const resume = typeof nextOffset === "number" ? `continue with --offset ${nextOffset}, ` : "";
  return `… cut at ${bytes} bytes; ${resume}${hint ?? LIST_TRUNCATION_REMEDY}`;
}

const ITEM_OVERSIZE_REMEDY = "narrow with --fields or raise the cap with --max-bytes <n>";

export function itemOversizeMessage(bytes: number, maxBytes: number, hint?: string): string {
  return `output is ${bytes} bytes, over the ${maxBytes}-byte --max-bytes cap; ${hint ?? ITEM_OVERSIZE_REMEDY}`;
}

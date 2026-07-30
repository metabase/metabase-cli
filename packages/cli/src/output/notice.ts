export function warn(message: string): void {
  process.stderr.write(message + "\n");
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

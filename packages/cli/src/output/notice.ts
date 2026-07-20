export function warn(message: string): void {
  process.stderr.write(message + "\n");
}

export function listTruncationNotice(bytes: number): string {
  return `… cut at ${bytes} bytes; narrow the selection or raise --max-bytes`;
}

const ITEM_OVERSIZE_REMEDY = "narrow with --fields or raise the cap with --max-bytes <n>";

export function itemOversizeMessage(bytes: number, maxBytes: number, hint?: string): string {
  return `output is ${bytes} bytes, over the ${maxBytes}-byte --max-bytes cap; ${hint ?? ITEM_OVERSIZE_REMEDY}`;
}

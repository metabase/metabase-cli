export function warn(message: string): void {
  process.stderr.write(message + "\n");
}

export function listTruncationNotice(bytes: number): string {
  return `… cut at ${bytes} bytes; rerun with --max-bytes 0`;
}

export function itemOversizeMessage(bytes: number, maxBytes: number): string {
  return `output is ${bytes} bytes, over the ${maxBytes}-byte --max-bytes cap; narrow with --fields, or pass --max-bytes 0 to disable`;
}

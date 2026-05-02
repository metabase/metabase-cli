export function warn(message: string): void {
  process.stderr.write(message + "\n");
}

export function listTruncationNotice(bytes: number): string {
  return `… cut at ${bytes} bytes; rerun with --max-bytes 0`;
}

export function itemOversizeNotice(bytes: number): string {
  return `… item is ${bytes} bytes (exceeds --max-bytes); narrow with --detail compact / --fields, or pass --max-bytes 0`;
}

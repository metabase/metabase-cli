const CARRIAGE_RETURN = "\r";
const NEWLINE = "\n";

// git redraws a progress line in place by returning to its start, so each line shows what a
// terminal would: the last thing written over it.
export function terminalText(raw: string): string {
  return raw
    .split(NEWLINE)
    .map((line) => {
      const drawn = line.split(CARRIAGE_RETURN).filter((segment) => segment.length > 0);
      return drawn[drawn.length - 1] ?? "";
    })
    .join(NEWLINE);
}

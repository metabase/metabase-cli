const DEFAULT_TERMINAL_WIDTH = 80;
const MIN_WRAP_WIDTH = 24;

// A line the terminal wraps itself restarts at column 0, so indented text wraps here instead.
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(width, MIN_WRAP_WIDTH);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") {
    lines.push(current);
  }
  return lines;
}

export function wrapWidth(): number {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : DEFAULT_TERMINAL_WIDTH;
}

export type TriggerKind = "mention" | "command";

export interface ComposerTrigger {
  readonly kind: TriggerKind;
  readonly query: string;
  readonly start: number;
  readonly end: number;
}

export interface ComposerEdit {
  readonly text: string;
  readonly cursor: number;
}

const MENTION_MARK = "@";
const COMMAND_MARK = "/";
const LINE_SEPARATOR = "\n";
const COMMAND_LINE = /^\/(\S*)$/;
const WHITESPACE = /\s/;

function lineStart(text: string, cursor: number): number {
  const found = text.lastIndexOf(LINE_SEPARATOR, cursor - 1);
  return found + 1;
}

function tokenStart(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0) {
    const character = text.slice(index - 1, index);
    if (WHITESPACE.test(character)) {
      return index;
    }
    index -= 1;
  }
  return 0;
}

export function triggerAt(text: string, cursor: number): ComposerTrigger | null {
  const line = lineStart(text, cursor);
  const command = COMMAND_LINE.exec(text.slice(line, cursor));
  const commandQuery = command?.[1];
  if (commandQuery !== undefined) {
    return { kind: "command", query: commandQuery, start: line, end: cursor };
  }
  const start = tokenStart(text, cursor);
  const token = text.slice(start, cursor);
  if (!token.startsWith(MENTION_MARK)) {
    return null;
  }
  return { kind: "mention", query: token.slice(MENTION_MARK.length), start, end: cursor };
}

export function applyTrigger(text: string, trigger: ComposerTrigger, value: string): ComposerEdit {
  const mark = trigger.kind === "mention" ? MENTION_MARK : COMMAND_MARK;
  const written = `${mark}${value} `;
  return {
    text: `${text.slice(0, trigger.start)}${written}${text.slice(trigger.end)}`,
    cursor: trigger.start + written.length,
  };
}

const TRAILING_SPACE = /\s$/;

// A mention added from outside the field goes after what is already typed, set off by a space.
export function appendMention(text: string, path: string): string {
  const separator = text.length === 0 || TRAILING_SPACE.test(text) ? "" : " ";
  return `${text}${separator}${MENTION_MARK}${path} `;
}

function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

export function matchPaths(
  paths: readonly string[],
  query: string,
  limit: number,
): readonly string[] {
  const wanted = query.toLowerCase();
  const onName: string[] = [];
  const onPath: string[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (basename(lower).includes(wanted)) {
      onName.push(path);
    } else if (lower.includes(wanted)) {
      onPath.push(path);
    }
    if (onName.length >= limit) {
      break;
    }
  }
  return [...onName, ...onPath].slice(0, limit);
}

export function matchCommands(
  commands: readonly string[],
  query: string,
  limit: number,
): readonly string[] {
  const wanted = query.toLowerCase();
  return commands.filter((command) => command.toLowerCase().startsWith(wanted)).slice(0, limit);
}

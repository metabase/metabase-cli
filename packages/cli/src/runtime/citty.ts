import type { ArgsDef, CommandDef, CommandMeta, Resolvable, SubCommandsDef } from "citty";

type CittyValue = CommandMeta | ArgsDef | SubCommandsDef | CommandDef;

export async function resolveCitty<T extends CittyValue>(
  value: Resolvable<T> | undefined,
): Promise<T | undefined> {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "function") {
    return value();
  }
  return value;
}

export function toAliasArray(alias: string | string[] | undefined): string[] {
  if (alias === undefined) {
    return [];
  }
  return Array.isArray(alias) ? alias : [alias];
}

export const ARGUMENT_SEPARATOR = "--";
export const NEGATION_PREFIX = "--no-";
const INLINE_VALUE = "=";
const LONG_PREFIX = "--";
const SHORT_PREFIX = "-";
const SHORT_FLAG_LENGTH = 2;
const WORD_SEPARATORS: ReadonlySet<string> = new Set(["-", "_", "/", "."]);
// No flag name starts with a digit, so a token like `-5` or `-0.5` can only be a value.
const NEGATIVE_NUMBER = /^-\.?\d/;
const DIGIT = /\d/;

export interface ResolvedFlag {
  key: string;
  negated: boolean;
  takesValue: boolean;
}

// Every token citty binds to a declared flag. citty hands node's parser the flag's name, that
// name's camel- and kebab-case forms and each alias as written (a one-letter alias also as `-x`),
// and strips `--no-<any of those>` itself to set the flag false. No other spelling binds:
// `--MAX-BYTES` parses as an unknown flag and is dropped.
export type FlagSpellings = ReadonlyMap<string, ResolvedFlag>;

export function flagSpellings(argsDef: ArgsDef): FlagSpellings {
  const spellings = new Map<string, ResolvedFlag>();
  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type === "positional") {
      continue;
    }
    const takesValue = def.type === "string" || def.type === "enum";
    const aliases = "alias" in def ? toAliasArray(def.alias) : [];
    const words = splitWords(key);
    for (const name of new Set([key, camelCase(words), kebabCase(words), ...aliases])) {
      spellings.set(`${LONG_PREFIX}${name}`, { key, negated: false, takesValue });
      spellings.set(`${NEGATION_PREFIX}${name}`, { key, negated: true, takesValue });
    }
    for (const letter of aliases.filter((alias) => alias.length === 1)) {
      spellings.set(`${SHORT_PREFIX}${letter}`, { key, negated: false, takesValue });
    }
  }
  return spellings;
}

export interface ParsedFlag {
  // The flag as typed, without the value attached to it.
  name: string;
  flag: ResolvedFlag | null;
  hasInlineValue: boolean;
}

export function parseFlagToken(token: string, spellings: FlagSpellings): ParsedFlag {
  const equals = token.indexOf(INLINE_VALUE);
  const name = equals === -1 ? token : token.slice(0, equals);
  const hasInlineValue = equals !== -1;
  const flag = spellings.get(name);
  if (flag !== undefined) {
    // citty drops a `--no-x=…` token whole rather than negating `x`.
    return { name, flag: flag.negated && hasInlineValue ? null : flag, hasInlineValue };
  }
  // `-mcard`: node's parser reads a one-letter value flag's value from the rest of the token.
  const short = name.slice(0, SHORT_FLAG_LENGTH);
  const shortFlag = name.startsWith(LONG_PREFIX) ? undefined : spellings.get(short);
  if (shortFlag !== undefined && shortFlag.takesValue) {
    return { name: short, flag: shortFlag, hasInlineValue: true };
  }
  return { name, flag: null, hasInlineValue };
}

export function isFlagToken(token: string): boolean {
  return token.startsWith(SHORT_PREFIX) && token !== SHORT_PREFIX && !NEGATIVE_NUMBER.test(token);
}

export function isNegativeNumber(token: string): boolean {
  return NEGATIVE_NUMBER.test(token);
}

export interface FlagItem extends ParsedFlag {
  kind: "flag";
  index: number;
  // Whether citty binds the next token as this flag's value, whatever that token is.
  consumesNext: boolean;
  value: string | undefined;
  end: number;
}

interface PositionalItem {
  kind: "positional";
  index: number;
  token: string;
}

interface SeparatorItem {
  kind: "separator";
  index: number;
}

export type ArgvItem = FlagItem | PositionalItem | SeparatorItem;

// Reads tokens the way citty will: a value-taking flag swallows the next token whatever it is, and
// everything after `--` is positional.
export function* readArgv(
  rawArgs: readonly string[],
  spellings: FlagSpellings,
  start = 0,
): Generator<ArgvItem> {
  let index = start;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (token === undefined) {
      return;
    }
    if (token === ARGUMENT_SEPARATOR) {
      yield { kind: "separator", index };
      for (const [offset, rest] of rawArgs.slice(index + 1).entries()) {
        yield { kind: "positional", index: index + 1 + offset, token: rest };
      }
      return;
    }
    if (!isFlagToken(token)) {
      yield { kind: "positional", index, token };
      index += 1;
      continue;
    }
    const item = readFlag(rawArgs, index, parseFlagToken(token, spellings));
    yield item;
    index = item.end;
  }
}

function readFlag(rawArgs: readonly string[], index: number, parsed: ParsedFlag): FlagItem {
  const { flag } = parsed;
  const consumesNext = flag !== null && flag.takesValue && !flag.negated && !parsed.hasInlineValue;
  const value = consumesNext ? rawArgs[index + 1] : undefined;
  const end = value === undefined ? index + 1 : index + 2;
  return { kind: "flag", index, ...parsed, consumesNext, value, end };
}

// scule's word split, which citty applies to a flag name: at a separator, at a lower-to-upper step,
// and before the last capital of a capital run; a digit is neither case.
function splitWords(name: string): string[] {
  const words: string[] = [];
  let word = "";
  let previousUpper: boolean | null = null;
  for (const char of name) {
    if (WORD_SEPARATORS.has(char)) {
      words.push(word);
      word = "";
      previousUpper = null;
      continue;
    }
    const upper = DIGIT.test(char) ? null : char !== char.toLowerCase();
    if (previousUpper === false && upper === true) {
      words.push(word);
      word = char;
    } else if (previousUpper === true && upper === false && word.length > 1) {
      words.push(word.slice(0, -1));
      word = `${word.slice(-1)}${char}`;
    } else {
      word += char;
    }
    previousUpper = upper;
  }
  words.push(word);
  return words;
}

function camelCase(words: readonly string[]): string {
  const pascal = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join("");
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
}

function kebabCase(words: readonly string[]): string {
  return words.map((word) => word.toLowerCase()).join("-");
}

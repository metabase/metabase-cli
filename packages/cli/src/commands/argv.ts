import type { ArgsDef } from "citty";

import { ConfigError } from "@metabase/client/errors";
import {
  ARGUMENT_SEPARATOR,
  type FlagItem,
  type FlagSpellings,
  type ResolvedFlag,
  NEGATION_PREFIX,
  flagSpellings,
  isFlagToken,
  isNegativeNumber,
  parseFlagToken,
  readArgv,
} from "../runtime/citty";
import { LIST_SEPARATOR } from "../runtime/csv";

const BUILTIN_FLAGS: ReadonlyArray<string> = ["--help", "-h", "--version", "-v"];
const SHELL_SAFE_WORD = /^[\w.,:/@%+=-]+$/;

function commandSpellings(argsDef: ArgsDef): FlagSpellings {
  const builtins = BUILTIN_FLAGS.map((flag): [string, ResolvedFlag] => [
    flag,
    { key: flag, negated: false, takes: "nothing" },
  ]);
  return new Map([...builtins, ...flagSpellings(argsDef)]);
}

// Node's parser reads `-5` as a flag named "5", which leaves `field remapping 1 2 -5` a positional
// short. Moving every positional behind `--`, flags first, keeps the order of both and makes citty
// bind the number as the value it is.
export function separatePositionals(rawArgs: readonly string[], argsDef: ArgsDef): string[] {
  const flagTokens: string[] = [];
  const positionals: string[] = [];
  for (const item of readArgv(rawArgs, commandSpellings(argsDef))) {
    if (item.kind === "flag") {
      flagTokens.push(...rawArgs.slice(item.index, item.end));
    } else if (item.kind === "positional") {
      positionals.push(item.token);
    }
  }
  if (!positionals.some(isNegativeNumber)) {
    return [...rawArgs];
  }
  return [...flagTokens, ARGUMENT_SEPARATOR, ...positionals];
}

// The declared flags the user typed, by key: citty fills a flag's default in whether or not it
// was typed.
export function givenFlagKeys(rawArgs: readonly string[], argsDef: ArgsDef): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of readArgv(rawArgs, flagSpellings(argsDef))) {
    if (item.kind === "flag" && item.flag !== null && !item.flag.negated) {
      keys.add(item.flag.key);
    }
  }
  return keys;
}

// Refuses what citty would otherwise parse into something the user did not type: an undeclared
// flag or a spelling citty does not bind; `--no-` on a flag that takes a value, which citty turns
// into `false`; a value-taking flag whose value is missing, which citty fills with the next flag
// (`--text --remove` stores the note "--remove" and never removes) or with ""; a value-taking flag
// given twice, of which citty keeps only the last; and a positional beyond the declared ones,
// which citty drops.
export function assertArgv(rawArgs: readonly string[], argsDef: ArgsDef): void {
  const spellings = commandSpellings(argsDef);
  const valueFlags: ValueFlag[] = [];
  const positionals: string[] = [];
  for (const item of readArgv(rawArgs, spellings)) {
    if (item.kind === "positional") {
      positionals.push(item.token);
    } else if (item.kind === "flag") {
      const valueFlag = readValueFlag(item, spellings);
      if (valueFlag !== null) {
        valueFlags.push(valueFlag);
      }
    }
  }
  assertEachGivenOnce(valueFlags);
  assertPositionalCount(positionals, argsDef);
}

interface ValueFlag {
  name: string;
  flag: ResolvedFlag;
  value: string;
}

function readValueFlag(item: FlagItem, spellings: FlagSpellings): ValueFlag | null {
  const { flag, name } = item;
  if (flag === null) {
    throw new ConfigError(`unknown flag: ${name}`);
  }
  if (flag.takes === "nothing") {
    return null;
  }
  if (flag.negated) {
    const positive = `--${name.slice(NEGATION_PREFIX.length)}`;
    throw new ConfigError(`${name}: ${positive} takes a value, so it cannot be negated`);
  }
  return { name, flag, value: readFlagValue(item, spellings) };
}

function assertPositionalCount(positionals: readonly string[], argsDef: ArgsDef): void {
  const declared = Object.entries(argsDef)
    .filter(([, def]) => def.type === "positional")
    .map(([name]) => `<${name}>`);
  const extra = positionals[declared.length];
  if (extra === undefined) {
    return;
  }
  const detail =
    declared.length === 0
      ? "this command takes no positional arguments"
      : `this command takes ${declared.join(" ")}; quote an argument that contains spaces`;
  throw new ConfigError(`unexpected argument: "${extra}" (${detail})`);
}

// Runs after every flag is read, so the joined spelling offered for a list flag holds only values
// that each passed the checks above.
function assertEachGivenOnce(valueFlags: readonly ValueFlag[]): void {
  const first = new Map<string, ValueFlag>();
  for (const repeat of valueFlags) {
    const earlier = first.get(repeat.flag.key);
    if (earlier === undefined) {
      first.set(repeat.flag.key, repeat);
      continue;
    }
    const also = earlier.name === repeat.name ? "" : ` (also as ${earlier.name})`;
    const joined = joinedSpelling(repeat, valueFlags);
    throw new ConfigError(`${repeat.name} is given more than once${also}; pass it once${joined}`);
  }
}

// Offered as `--<key>=<value>` so a pasted suggestion binds as written: a value starting with "-"
// in its own token reads as a flag, and node binds a one-letter alias's "=" into the value.
function joinedSpelling(repeat: ValueFlag, valueFlags: readonly ValueFlag[]): string {
  if (repeat.flag.takes !== "list") {
    return "";
  }
  const joined = valueFlags
    .filter((valueFlag) => valueFlag.flag.key === repeat.flag.key)
    .map((valueFlag) => valueFlag.value)
    .join(LIST_SEPARATOR);
  return `, as --${repeat.flag.key}=${quoteForShell(joined)}`;
}

// A POSIX shell passes a single-quoted word through untouched except for the quote itself, which
// has to close the quoting, sit escaped, and reopen it.
function quoteForShell(value: string): string {
  if (SHELL_SAFE_WORD.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function readFlagValue(item: FlagItem, spellings: FlagSpellings): string {
  const { name, value, consumesNext } = item;
  if (value === null || (consumesNext && value === ARGUMENT_SEPARATOR)) {
    throw new ConfigError(`${name} needs a value`);
  }
  if (consumesNext && readsAsFlag(value, spellings)) {
    throw new ConfigError(
      `${name} needs a value, but the flag ${parseFlagToken(value, spellings).name} follows it; write ${name}=<value> for a value that starts with "-"`,
    );
  }
  return value;
}

// citty strips every `--no-…` token before parsing, so one is never a value: the flag takes the
// token after it instead. A declared flag in the value's place is taken as the value, though it
// was surely meant as the flag.
function readsAsFlag(value: string, spellings: FlagSpellings): boolean {
  if (!isFlagToken(value)) {
    return false;
  }
  return value.startsWith(NEGATION_PREFIX) || parseFlagToken(value, spellings).flag !== null;
}

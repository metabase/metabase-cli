import type { ArgsDef } from "citty";

import { ConfigError } from "@metabase/client/errors";
import {
  ARGUMENT_SEPARATOR,
  type FlagItem,
  type FlagSpellings,
  type ResolvedFlag,
  flagSpellings,
  isFlagToken,
  isNegativeNumber,
  parseFlagToken,
  readArgv,
} from "../runtime/citty";

const BUILTIN_FLAGS: ReadonlyArray<string> = ["--help", "-h", "--version", "-v"];

function commandSpellings(argsDef: ArgsDef): FlagSpellings {
  const builtins = BUILTIN_FLAGS.map((flag): [string, ResolvedFlag] => [
    flag,
    { key: flag, negated: false, takesValue: false },
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

// Refuses what citty would otherwise parse into something the user did not type: an undeclared
// flag or a spelling citty does not bind; a value-taking flag whose value is missing, which citty
// fills with the next flag (`--text --remove` stores the note "--remove" and never removes) or
// with ""; a value-taking flag given twice, of which citty keeps only the last; and a positional
// beyond the declared ones, which citty drops.
export function assertArgv(rawArgs: readonly string[], argsDef: ArgsDef): void {
  const spellings = commandSpellings(argsDef);
  const seenValueFlags = new Map<string, string>();
  const positionals: string[] = [];
  for (const item of readArgv(rawArgs, spellings)) {
    if (item.kind === "positional") {
      positionals.push(item.token);
    } else if (item.kind === "flag") {
      assertFlag(item, spellings, seenValueFlags);
    }
  }
  assertPositionalCount(positionals, argsDef);
}

function assertFlag(item: FlagItem, spellings: FlagSpellings, seen: Map<string, string>): void {
  const { flag, name } = item;
  if (flag === null) {
    throw new ConfigError(`unknown flag: ${name}`);
  }
  if (flag.negated || !flag.takesValue) {
    return;
  }
  assertFirstOccurrence(name, flag.key, seen);
  if (item.consumesNext) {
    assertValueFollows(name, item.value, spellings);
  }
}

function assertPositionalCount(positionals: readonly string[], argsDef: ArgsDef): void {
  const declared = Object.entries(argsDef)
    .filter(([, def]) => def.type === "positional")
    .map(([name]) => `<${name}>`);
  const extra = positionals[declared.length];
  if (extra === undefined) {
    return;
  }
  const takes =
    declared.length === 0
      ? "this command takes no positional arguments"
      : `this command takes ${declared.join(" ")}`;
  throw new ConfigError(`unexpected argument: "${extra}" (${takes})`);
}

function assertFirstOccurrence(name: string, key: string, seen: Map<string, string>): void {
  const earlier = seen.get(key);
  if (earlier === undefined) {
    seen.set(key, name);
    return;
  }
  const also = earlier === name ? "" : ` (also as ${earlier})`;
  throw new ConfigError(`${name} is given more than once${also}; pass it once`);
}

function assertValueFollows(
  name: string,
  value: string | undefined,
  spellings: FlagSpellings,
): void {
  if (value === undefined || value === ARGUMENT_SEPARATOR) {
    throw new ConfigError(`${name} needs a value`);
  }
  if (readsAsFlag(value, spellings)) {
    throw new ConfigError(
      `${name} needs a value, but the flag ${parseFlagToken(value, spellings).name} follows it; write ${name}=<value> for a value that starts with "-"`,
    );
  }
}

// A declared flag in the value's place is taken as the value, though it was surely meant as the
// flag.
function readsAsFlag(value: string, spellings: FlagSpellings): boolean {
  return isFlagToken(value) && parseFlagToken(value, spellings).flag !== null;
}

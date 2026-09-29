import type { ArgsDef } from "citty";

import { ConfigError } from "@metabase/client/errors";
import { flagConsumesValue, normalizeFlag, toAliasArray } from "../runtime/citty";

const ARGUMENT_SEPARATOR = "--";
const NEGATION_PREFIX = "no-";
const BUILTIN_FLAGS: ReadonlyArray<string> = ["help", "h", "version", "v"];

// Maps every spelling a flag can take (name, alias, camel or kebab case) to its declared key.
type FlagKeys = ReadonlyMap<string, string>;

// One flag as typed, with the token citty hands it as its value when it takes one.
interface FlagOccurrence {
  token: string;
  consumed: boolean;
  value: string | undefined;
}

interface ScannedArgv {
  flags: FlagOccurrence[];
  positionals: string[];
}

// Classifies tokens the way citty will read them: a value-taking flag swallows the next token
// whatever it is, and everything after `--` is positional.
function scanArgv(rawArgs: readonly string[], argsDef: ArgsDef): ScannedArgv {
  const flags: FlagOccurrence[] = [];
  const positionals: string[] = [];
  let index = 0;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (token === undefined) {
      break;
    }
    if (token === ARGUMENT_SEPARATOR) {
      positionals.push(...rawArgs.slice(index + 1));
      break;
    }
    if (!isFlagToken(token)) {
      positionals.push(token);
      index += 1;
      continue;
    }
    const consumed = flagConsumesValue(token, argsDef);
    flags.push({ token, consumed, value: consumed ? rawArgs[index + 1] : undefined });
    index += consumed ? 2 : 1;
  }
  return { flags, positionals };
}

// Refuses what citty would otherwise parse into something the user did not type: an undeclared
// flag; a value-taking flag whose value is missing, which citty fills with the next flag
// (`--text --remove` stores the note "--remove" and never removes) or with ""; a value-taking
// flag given twice, of which citty keeps only the last; and a positional beyond the declared
// ones, which citty drops.
export function assertArgv(rawArgs: readonly string[], argsDef: ArgsDef): void {
  const keys = flagKeys(argsDef);
  const scanned = scanArgv(rawArgs, argsDef);
  const seenValueFlags = new Map<string, string>();
  for (const occurrence of scanned.flags) {
    const flag = resolveFlag(occurrence.token, keys);
    if (flag === null) {
      throw new ConfigError(`unknown flag: ${displayFlag(occurrence.token)}`);
    }
    if (flag.negated || !takesValue(argsDef, flag.key)) {
      continue;
    }
    assertFirstOccurrence(occurrence.token, flag.key, seenValueFlags);
    if (occurrence.consumed) {
      assertValueFollows(occurrence.token, occurrence.value, keys);
    }
  }
  assertPositionalCount(scanned.positionals, argsDef);
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

function assertFirstOccurrence(token: string, key: string, seen: Map<string, string>): void {
  const earlier = seen.get(key);
  if (earlier !== undefined) {
    throw new ConfigError(
      `${displayFlag(token)} is given more than once (first as ${earlier}); pass it once`,
    );
  }
  seen.set(key, displayFlag(token));
}

function assertValueFollows(token: string, value: string | undefined, keys: FlagKeys): void {
  if (value === undefined || value === ARGUMENT_SEPARATOR) {
    throw new ConfigError(`${token} needs a value`);
  }
  if (isFlagToken(value) && resolveFlag(value, keys) !== null) {
    throw new ConfigError(
      `${token} needs a value, but the flag ${displayFlag(value)} follows it; write ${token}=<value> for a value that starts with "-"`,
    );
  }
}

function takesValue(argsDef: ArgsDef, key: string): boolean {
  return flagConsumesValue(`--${key}`, argsDef);
}

function flagKeys(argsDef: ArgsDef): Map<string, string> {
  const keys = new Map<string, string>(BUILTIN_FLAGS.map((flag) => [normalizeFlag(flag), flag]));
  for (const [name, def] of Object.entries(argsDef)) {
    keys.set(normalizeFlag(name), name);
    if ("alias" in def) {
      for (const alias of toAliasArray(def.alias)) {
        keys.set(normalizeFlag(alias), name);
      }
    }
  }
  return keys;
}

interface ResolvedFlag {
  key: string;
  negated: boolean;
}

function resolveFlag(token: string, keys: FlagKeys): ResolvedFlag | null {
  const name = displayFlag(token).replace(/^-+/, "");
  const key = keys.get(normalizeFlag(name));
  if (key !== undefined) {
    return { key, negated: false };
  }
  if (!name.startsWith(NEGATION_PREFIX)) {
    return null;
  }
  const negatedKey = keys.get(normalizeFlag(name.slice(NEGATION_PREFIX.length)));
  return negatedKey === undefined ? null : { key: negatedKey, negated: true };
}

function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}

function displayFlag(token: string): string {
  const equals = token.indexOf("=");
  return equals === -1 ? token : token.slice(0, equals);
}

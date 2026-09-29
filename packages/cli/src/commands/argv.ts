import type { ArgsDef } from "citty";

import { ConfigError } from "@metabase/client/errors";
import { flagConsumesValue, normalizeFlag, toAliasArray } from "../runtime/citty";

const ARGUMENT_SEPARATOR = "--";
const NEGATION_PREFIX = "no-";
const BUILTIN_FLAGS: ReadonlyArray<string> = ["help", "h", "version", "v"];

// Refuses what citty would otherwise parse into something the user did not type: an undeclared
// flag, and a value-taking flag whose value is missing, which citty fills with the next flag
// (`--text --remove` stores the note "--remove" and never removes) or with "".
export function assertArgv(rawArgs: readonly string[], argsDef: ArgsDef): void {
  const allowed = allowedFlagKeys(argsDef);
  let index = 0;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (token === undefined || token === ARGUMENT_SEPARATOR) {
      return;
    }
    if (!isFlagToken(token)) {
      index += 1;
      continue;
    }
    if (!isAllowedFlag(token, allowed)) {
      throw new ConfigError(`unknown flag: ${displayFlag(token)}`);
    }
    if (!flagConsumesValue(token, argsDef)) {
      index += 1;
      continue;
    }
    assertValueFollows(token, rawArgs[index + 1], allowed);
    index += 2;
  }
}

function assertValueFollows(
  token: string,
  value: string | undefined,
  allowed: ReadonlySet<string>,
): void {
  if (value === undefined || value === ARGUMENT_SEPARATOR) {
    throw new ConfigError(`${token} needs a value`);
  }
  if (isFlagToken(value) && isAllowedFlag(value, allowed)) {
    throw new ConfigError(
      `${token} needs a value, but the flag ${displayFlag(value)} follows it; write ${token}=<value> for a value that starts with "-"`,
    );
  }
}

function allowedFlagKeys(argsDef: ArgsDef): Set<string> {
  const keys = new Set<string>(BUILTIN_FLAGS.map(normalizeFlag));
  for (const [name, def] of Object.entries(argsDef)) {
    keys.add(normalizeFlag(name));
    if ("alias" in def) {
      for (const alias of toAliasArray(def.alias)) {
        keys.add(normalizeFlag(alias));
      }
    }
  }
  return keys;
}

function isAllowedFlag(token: string, allowed: ReadonlySet<string>): boolean {
  return flagCandidates(token).some((candidate) => allowed.has(candidate));
}

function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}

function displayFlag(token: string): string {
  const equals = token.indexOf("=");
  return equals === -1 ? token : token.slice(0, equals);
}

function flagCandidates(token: string): string[] {
  const name = displayFlag(token).replace(/^-+/, "");
  const candidates = [normalizeFlag(name)];
  if (name.startsWith(NEGATION_PREFIX)) {
    candidates.push(normalizeFlag(name.slice(NEGATION_PREFIX.length)));
  }
  return candidates;
}

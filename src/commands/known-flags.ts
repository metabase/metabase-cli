import type { ArgsDef } from "citty";

import { ConfigError } from "../core/errors";
import { flagConsumesValue, normalizeFlag, toAliasArray } from "../runtime/citty";

const ARGUMENT_SEPARATOR = "--";
const NEGATION_PREFIX = "no-";
const BUILTIN_FLAGS: ReadonlyArray<string> = ["help", "h", "version", "v"];

export function assertKnownFlags(rawArgs: readonly string[], argsDef: ArgsDef): void {
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
    const matched = flagCandidates(token).some((candidate) => allowed.has(candidate));
    if (!matched) {
      throw new ConfigError(`unknown flag: ${displayFlag(token)}`);
    }
    index += flagConsumesValue(token, argsDef) ? 2 : 1;
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

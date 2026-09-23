import type { ArgsDef } from "citty";

import { ConfigError } from "@metabase/client/errors";
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
      throw new ConfigError(unknownFlagMessage(token, argsDef));
    }
    index += flagConsumesValue(token, argsDef) ? 2 : 1;
  }
}

function unknownFlagMessage(token: string, argsDef: ArgsDef): string {
  const shown = displayFlag(token);
  const suggestion = closestFlag(shown, argsDef);
  const hint =
    suggestion === null ? "see --help for this command's flags" : `did you mean ${suggestion}?`;
  return `unknown flag: ${shown}; ${hint}`;
}

// A prefix either way names what an agent shortened or extended, as `--db` for `--db-id`.
function closestFlag(shown: string, argsDef: ArgsDef): string | null {
  const wanted = normalizeFlag(shown);
  const match = Object.entries(argsDef).find(([name, def]) => {
    const known = normalizeFlag(name);
    return def.type !== "positional" && (known.startsWith(wanted) || wanted.startsWith(known));
  });
  return match === undefined ? null : `--${kebabCase(match[0])}`;
}

function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
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

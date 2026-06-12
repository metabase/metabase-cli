import type { ArgsDef } from "citty";

import { flagConsumesValue, normalizeFlag, toAliasArray } from "../runtime/citty";

import { connectionFlags, outputFlags, profileFlag } from "./flags";

const ARGUMENT_SEPARATOR = "--";
const NEGATION_PREFIX = "no-";

export const GLOBAL_FLAG_ARGS: ArgsDef = { ...outputFlags, ...profileFlag, ...connectionFlags };

const GLOBAL_FLAG_NAMES: ReadonlySet<string> = buildGlobalFlagNames();

function buildGlobalFlagNames(): Set<string> {
  const names = new Set<string>();
  for (const [key, def] of Object.entries(GLOBAL_FLAG_ARGS)) {
    names.add(normalizeFlag(key));
    if ("alias" in def) {
      for (const alias of toAliasArray(def.alias)) {
        names.add(normalizeFlag(alias));
      }
    }
  }
  return names;
}

function isGlobalFlag(token: string): boolean {
  if (!token.startsWith("-") || token === ARGUMENT_SEPARATOR) {
    return false;
  }
  const raw = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
  const name = normalizeFlag(raw);
  if (GLOBAL_FLAG_NAMES.has(name)) {
    return true;
  }
  const bare = raw.replace(/^-+/, "");
  if (bare.startsWith(NEGATION_PREFIX)) {
    return GLOBAL_FLAG_NAMES.has(normalizeFlag(bare.slice(NEGATION_PREFIX.length)));
  }
  return false;
}

// `--profile`/`--url`/`--apiKey` (and the other common flags) are per-leaf citty args, not
// true globals. Placed before the verb chain, citty consumes the flag VALUE as a subcommand
// name and fails with a misleading "unknown command <value>". Hoisting the leading run of
// recognized global flags to the tail — after the verb chain — lets them parse at the resolved
// leaf, so `mb --profile staging card list` behaves like `mb card list --profile staging`.
export function hoistGlobalFlags(rawArgs: readonly string[]): string[] {
  const leading: string[] = [];
  let index = 0;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (token === undefined || !isGlobalFlag(token)) {
      break;
    }
    leading.push(token);
    index += 1;
    if (flagConsumesValue(token, GLOBAL_FLAG_ARGS) && index < rawArgs.length) {
      const value = rawArgs[index];
      if (value !== undefined) {
        leading.push(value);
        index += 1;
      }
    }
  }
  if (leading.length === 0) {
    return [...rawArgs];
  }
  return [...rawArgs.slice(index), ...leading];
}

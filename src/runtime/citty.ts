import type { ArgsDef, CommandDef, CommandMeta, Resolvable, SubCommandsDef } from "citty";

export type CittyValue = CommandMeta | ArgsDef | SubCommandsDef | CommandDef;

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

export function normalizeFlag(value: string): string {
  return value.replace(/^-+/, "").replace(/-/g, "").toLowerCase();
}

// citty (this version) parses repeated string flags via Node's `util.parseArgs` without
// `multiple`, so `--x a --x b` collapses to the last value. For genuinely repeatable flags we
// recover every occurrence straight from rawArgs. Matches the flag's own name and any aliases,
// the `--flag value` and `--flag=value` (and short `-a value`) forms, and stops at `--`.
export function collectRepeatedFlag(
  rawArgs: readonly string[],
  flagName: string,
  argsDef: ArgsDef,
): string[] {
  const def = argsDef[flagName];
  const aliases = def !== undefined && "alias" in def ? toAliasArray(def.alias) : [];
  const names = new Set<string>([normalizeFlag(flagName), ...aliases.map(normalizeFlag)]);
  const values: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    if (token === undefined || token === "--") {
      break;
    }
    if (!token.startsWith("-")) {
      continue;
    }
    const equals = token.indexOf("=");
    const head = equals === -1 ? token : token.slice(0, equals);
    if (!names.has(normalizeFlag(head))) {
      continue;
    }
    if (equals !== -1) {
      values.push(token.slice(equals + 1));
      continue;
    }
    const next = rawArgs[i + 1];
    if (next !== undefined) {
      values.push(next);
      i += 1;
    }
  }
  return values;
}

export function flagConsumesValue(token: string, argsDef: ArgsDef): boolean {
  if (token.includes("=")) {
    return false;
  }
  const name = normalizeFlag(token);
  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type !== "string" && def.type !== "enum") {
      continue;
    }
    if (normalizeFlag(key) === name) {
      return true;
    }
    if (toAliasArray(def.alias).some((alias) => normalizeFlag(alias) === name)) {
      return true;
    }
  }
  return false;
}

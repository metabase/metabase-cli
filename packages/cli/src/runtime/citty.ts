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

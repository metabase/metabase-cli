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

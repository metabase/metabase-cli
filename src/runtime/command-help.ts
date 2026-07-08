import type { ArgDef, ArgsDef, CommandDef, CommandMeta } from "citty";
import { z } from "zod";

import { Capabilities } from "./capabilities";
import { resolveCitty, toAliasArray } from "./citty";
import { getMetabaseAugment, type MetabaseAugment } from "./command-augment";

export const CommandHelpArg = z.object({
  name: z.string(),
  type: z.enum(["string", "boolean", "positional", "enum"]),
  required: z.boolean(),
  description: z.string().optional(),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
  alias: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
});
export type CommandHelpArg = z.infer<typeof CommandHelpArg>;

export const CommandHelpSkill = z.object({
  skill: z.string(),
  purpose: z.string(),
});
export type CommandHelpSkill = z.infer<typeof CommandHelpSkill>;

export const CommandHelpEntry = z.object({
  command: z.string(),
  description: z.string(),
  details: z.string().optional(),
  skills: z.array(CommandHelpSkill),
  examples: z.array(z.string()),
  args: z.array(CommandHelpArg),
  inputSchema: z.unknown().nullable(),
  outputSchema: z.unknown().nullable(),
  capabilities: Capabilities.nullable(),
});
export type CommandHelpEntry = z.infer<typeof CommandHelpEntry>;

export const CommandIndexEntry = z.object({
  command: z.string(),
  description: z.string(),
});
export type CommandIndexEntry = z.infer<typeof CommandIndexEntry>;

export const CommandHelpIndex = z.object({
  commands: z.array(CommandIndexEntry),
});
export type CommandHelpIndex = z.infer<typeof CommandHelpIndex>;

const EMPTY_AUGMENT: MetabaseAugment = {
  examples: [],
  details: null,
  skills: [],
  inputSchema: null,
  outputSchema: null,
  capabilities: null,
};

export async function buildHelpEntry<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  path: string[],
): Promise<CommandHelpEntry> {
  const meta = await resolveCitty(cmd.meta);
  const args = (await resolveCitty(cmd.args)) ?? {};
  const augment = getMetabaseAugment(cmd) ?? EMPTY_AUGMENT;
  const entry: CommandHelpEntry = {
    command: path.join(" "),
    description: readDescription(meta),
    skills: Array.from(augment.skills),
    examples: Array.from(augment.examples),
    args: convertArgs(args),
    inputSchema: augment.inputSchema ? z.toJSONSchema(augment.inputSchema) : null,
    outputSchema: augment.outputSchema ? z.toJSONSchema(augment.outputSchema) : null,
    capabilities: augment.capabilities,
  };
  if (augment.details !== null) {
    entry.details = augment.details;
  }
  return entry;
}

export async function buildHelpIndex<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  path: string[],
): Promise<CommandHelpIndex> {
  return { commands: await walk(cmd, path) };
}

export async function resolveCommandPath(
  root: CommandDef,
  segments: readonly string[],
): Promise<CommandDef> {
  let current: CommandDef = root;
  for (const segment of segments) {
    const subCommands = await resolveCitty(current.subCommands);
    const next = subCommands === undefined ? undefined : await resolveCitty(subCommands[segment]);
    if (next === undefined) {
      throw new Error(`unknown command path segment '${segment}'`);
    }
    current = next;
  }
  return current;
}

async function walk<T extends ArgsDef>(
  cmd: CommandDef<T>,
  path: string[],
): Promise<CommandIndexEntry[]> {
  const meta = await resolveCitty(cmd.meta);
  if (meta?.hidden === true) {
    return [];
  }

  const subCommands = await resolveCitty(cmd.subCommands);
  if (subCommands && Object.keys(subCommands).length > 0) {
    const groups = await Promise.all(
      Object.entries(subCommands).map(async ([name, lazy]) => {
        const sub = await resolveCitty(lazy);
        return sub ? walk(sub, [...path, name]) : [];
      }),
    );
    return groups.flat();
  }

  return [{ command: path.join(" "), description: readDescription(meta) }];
}

function readDescription(meta: CommandMeta | undefined): string {
  if (meta === undefined) {
    return "";
  }
  return typeof meta.description === "string" ? meta.description : "";
}

function convertArgs(args: ArgsDef): CommandHelpArg[] {
  return Object.entries(args).map(([name, def]) => convertArg(name, def));
}

function convertArg(name: string, def: ArgDef): CommandHelpArg {
  const arg: CommandHelpArg = {
    name,
    type: def.type ?? "string",
    required: def.required === true && def.default === undefined,
  };
  if (def.description) {
    arg.description = def.description;
  }
  if (isPrimitiveDefault(def.default)) {
    arg.default = def.default;
  }
  const alias = readAlias(def);
  if (alias.length > 0) {
    arg.alias = alias;
  }
  const options = readOptions(def);
  if (options.length > 0) {
    arg.options = options;
  }
  return arg;
}

function readOptions(def: ArgDef): string[] {
  if (!("options" in def) || !Array.isArray(def.options)) {
    return [];
  }
  return [...def.options];
}

function readAlias(def: ArgDef): string[] {
  return "alias" in def ? toAliasArray(def.alias) : [];
}

function isPrimitiveDefault(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

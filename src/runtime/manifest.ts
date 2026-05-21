import type { ArgDef, ArgsDef, CommandDef, CommandMeta, Resolvable, SubCommandsDef } from "citty";
import { z } from "zod";

import { Capabilities } from "./capabilities";
import { getMetabaseAugment } from "./command-augment";

export const ManifestArg = z.object({
  name: z.string(),
  type: z.enum(["string", "boolean", "positional", "enum"]),
  required: z.boolean(),
  description: z.string().optional(),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
  alias: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
});
export type ManifestArg = z.infer<typeof ManifestArg>;

export const ManifestEntry = z.object({
  command: z.string(),
  description: z.string(),
  details: z.string().optional(),
  examples: z.array(z.string()),
  args: z.array(ManifestArg),
  outputSchema: z.unknown().nullable(),
  capabilities: Capabilities.nullable(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const Manifest = z.object({
  version: z.literal(1),
  commands: z.array(ManifestEntry),
});
export type Manifest = z.infer<typeof Manifest>;

export async function buildManifest(root: CommandDef): Promise<Manifest> {
  return { version: 1, commands: await walk(root, []) };
}

async function walk(cmd: CommandDef, path: string[]): Promise<ManifestEntry[]> {
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

  const args = (await resolveCitty(cmd.args)) ?? {};
  const augment = getMetabaseAugment(cmd);
  if (augment === null) {
    return [];
  }
  const entry: ManifestEntry = {
    command: path.join(" "),
    description: readDescription(meta),
    examples: Array.from(augment.examples),
    args: convertArgs(args),
    outputSchema: augment.outputSchema ? z.toJSONSchema(augment.outputSchema) : null,
    capabilities: augment.capabilities,
  };
  if (augment.details !== null && augment.details !== "") {
    entry.details = augment.details;
  }
  return [entry];
}

function readDescription(meta: CommandMeta | undefined): string {
  if (meta === undefined) {
    return "";
  }
  return typeof meta.description === "string" ? meta.description : "";
}

function convertArgs(args: ArgsDef): ManifestArg[] {
  return Object.entries(args).map(([name, def]) => convertArg(name, def));
}

function convertArg(name: string, def: ArgDef): ManifestArg {
  const arg: ManifestArg = {
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
  if (!("alias" in def) || def.alias === undefined) {
    return [];
  }
  return Array.isArray(def.alias) ? def.alias : [def.alias];
}

function isPrimitiveDefault(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

type CittyValue = CommandMeta | ArgsDef | SubCommandsDef | CommandDef;

async function resolveCitty<T extends CittyValue>(
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

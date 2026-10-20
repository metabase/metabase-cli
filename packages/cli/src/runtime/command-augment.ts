import type { ZodType } from "zod";

import type { FeatureName } from "@metabase/client/version/features";
import type { MethodKey } from "@metabase/client/version/requirements";

export interface SkillPointer {
  skill: string;
  purpose: string;
}

export interface CommandRequirements {
  methods: readonly MethodKey[];
  features: readonly FeatureName[];
}

// A body contract written as JSON Schema documents rather than as Zod. `bundle.schema` is the
// entry, which the documents' own `$ref`s call `documentName`; `bundle.defs` holds the documents it
// refers to, keyed by the name those `$ref`s use.
export interface JsonSchemaSource {
  documentName: string;
  bundle: JsonSchemaBundle;
}

interface JsonSchemaBundle {
  schema: unknown;
  defs: Readonly<Record<string, unknown>>;
}

export interface MetabaseAugment {
  examples: readonly string[];
  details: string | null;
  skills: readonly SkillPointer[];
  inputSchema: ZodType | null;
  // Where set, the contract the body is held to, which `inputSchema` only points at.
  inputJsonSchema: JsonSchemaSource | null;
  outputSchema: ZodType | null;
  requires: CommandRequirements | null;
}

const augments = new WeakMap<object, MetabaseAugment>();

export function setMetabaseAugment(cmd: object, augment: MetabaseAugment): void {
  augments.set(cmd, augment);
}

export function getMetabaseAugment(cmd: object): MetabaseAugment | null {
  return augments.get(cmd) ?? null;
}

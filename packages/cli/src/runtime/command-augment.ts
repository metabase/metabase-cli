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
  title: string;
  command: readonly string[];
  documentName: string;
  bundle: JsonSchemaBundle;
}

interface JsonSchemaBundle {
  schema: unknown;
  defs: Readonly<Record<string, unknown>>;
}

type BodyPredicate = (body: unknown) => boolean;

// A query inside a Zod body that the Zod schema leaves open and the command checks as MBQL 5.
export interface EmbeddedQuery {
  resource: string;
  path: readonly string[];
  when: BodyPredicate | null;
}

interface ZodContract {
  kind: "zod";
  schema: ZodType;
  embedded: readonly EmbeddedQuery[];
}

interface DocumentsContract {
  kind: "documents";
  source: JsonSchemaSource;
}

export type SchemaContract = ZodContract | DocumentsContract;

export interface MetabaseAugment {
  examples: readonly string[];
  details: string | null;
  skills: readonly SkillPointer[];
  input: SchemaContract | null;
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

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
// refers to, keyed by the name those `$ref`s use. `title` names what the documents describe, and
// `command` is the command whose body they are, so `mb schema <command>` prints them.
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

// Whether a body carries the embedded document at all, for a path only some shapes of the body hold.
export type BodyPredicate = (body: unknown) => boolean;

// A value a Zod body carries at `path` that the Zod schema leaves open and the command checks against
// `source` instead, on every body or only on those `when` accepts. `owner` is the resource the body
// describes, as a failed check names it.
export interface EmbeddedDocument {
  owner: string;
  path: readonly string[];
  source: JsonSchemaSource;
  when: BodyPredicate | null;
}

interface ZodContract {
  kind: "zod";
  schema: ZodType;
  embedded: readonly EmbeddedDocument[];
}

interface DocumentsContract {
  kind: "documents";
  source: JsonSchemaSource;
}

// What a JSON body or a command's output is held to. Only a body may be held to documents.
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

import { z, type ZodType } from "zod";

type JsonSchema = z.core.JSONSchema.BaseSchema;
type SubSchema = z.core.JSONSchema._JSONSchema;
type Io = "input" | "output";

export interface PathNote {
  readonly path: readonly string[];
  readonly note: string;
}

interface JsonSchemaParams extends Pick<z.core.ToJSONSchemaParams, "reused" | "metadata"> {
  readonly io: Io;
}

const OPTIONALITY = { input: "optin", output: "optout" } as const;

export const REFINED_PREFIX = "refined: ";
export const NOTE_SEPARATOR = "; ";
const LOCAL_DEFS_PREFIX = "#/$defs/";
const ALTERNATIVE_KEYWORDS = ["anyOf", "oneOf", "allOf"] as const;

// `.refine`, `.superRefine` and `.check` all add a check of this kind.
const CUSTOM_CHECK = "custom";

// A refinement noted here must carry a static message, so the issue handed to its error map is
// never read.
const UNREPORTED_ISSUE = { code: "custom", input: undefined } as const;

// Zod writes a tuple with no minItems and an open rest, and drops every refinement, so a validator
// reading its JSON Schema accepts what the Zod schema refuses.
export function toJsonSchema(schema: ZodType, params: JsonSchemaParams): JsonSchema {
  const { io } = params;
  return z.toJSONSchema(schema, {
    ...params,
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema instanceof z.core.$ZodTuple) {
        restoreArity(zodSchema, jsonSchema, io);
      }
      noteRefinements(zodSchema, jsonSchema);
    },
  });
}

// A described copy of an extracted tuple is a bare $ref, and the arity belongs on the definition it
// points to; written beside the $ref, items: false would leave no element allowed.
function restoreArity(tuple: z.core.$ZodTuple, json: JsonSchema, io: Io): void {
  if (json.prefixItems === undefined) {
    return;
  }
  const { items, rest } = tuple._zod.def;
  const lastRequired = items.findLastIndex((item) => item._zod[OPTIONALITY[io]] !== "optional");
  const required = lastRequired + 1;
  json.minItems = json.minItems === undefined ? required : Math.max(json.minItems, required);
  if (rest === null) {
    json.items = false;
  }
}

function noteRefinements(schema: z.core.$ZodType, json: JsonSchema): void {
  const notes = refinementMessages(schema, json).map((message) => `${REFINED_PREFIX}${message}`);
  if (notes.length === 0) {
    return;
  }
  const existing = json.description === undefined ? [] : [json.description];
  json.description = [...existing, ...notes].join(NOTE_SEPARATOR);
}

// A derived copy (`.describe`, `.min`, a further `.refine`) carries its parent's checks too, and
// when it is written as a $ref to the parent's definition, that definition already notes them.
function refinementMessages(schema: z.core.$ZodType, json: JsonSchema): string[] {
  const { checks } = schema._zod.def;
  if (checks === undefined) {
    return [];
  }
  const inherited = json.$ref === undefined ? [] : (schema._zod.parent?._zod.def.checks ?? []);
  return checks
    .filter((check) => check._zod.def.check === CUSTOM_CHECK && !inherited.includes(check))
    .map((check) => refinementMessage(schema, check));
}

function refinementMessage(schema: z.core.$ZodType, check: z.core.$ZodCheck): string {
  const message =
    check instanceof z.core.$ZodCustom
      ? reportedMessage(check._zod.def.error?.(UNREPORTED_ISSUE))
      : null;
  if (message === null) {
    throw new Error(
      `a refinement on a ${schema._zod.def.type} schema has no static message to note`,
    );
  }
  return message;
}

function reportedMessage(reported: ReturnType<z.core.$ZodErrorMap>): string | null {
  if (typeof reported === "string") {
    return reported;
  }
  return reported?.message ?? null;
}

export function notePaths(root: JsonSchema, notes: readonly PathNote[]): JsonSchema {
  return notes.reduce((noted, { path, note }) => {
    const reached = notePath(noted, path, note, noted.$defs);
    if (reached === null) {
      throw new Error(`no member at "${path.join(".")}" to note`);
    }
    return reached;
  }, root);
}

type Defs = Readonly<Record<string, JsonSchema>> | undefined;

// A `$ref` on the path is inlined as a noted copy, since the definition it names serves other
// members too.
function notePath(
  schema: SubSchema,
  path: readonly string[],
  note: string,
  defs: Defs,
): JsonSchema | null {
  if (typeof schema === "boolean") {
    return null;
  }
  const [key, ...rest] = path;
  if (key === undefined) {
    const description = schema.description === undefined ? [] : [schema.description];
    return { ...schema, description: [...description, note].join(NOTE_SEPARATOR) };
  }
  if (schema.$ref !== undefined) {
    return noteThroughRef(schema, schema.$ref, path, note, defs);
  }
  const noted: JsonSchema = { ...schema };
  let reached = false;
  const property = schema.properties?.[key];
  const notedProperty = property === undefined ? null : notePath(property, rest, note, defs);
  if (notedProperty !== null) {
    noted.properties = { ...schema.properties, [key]: notedProperty };
    reached = true;
  }
  for (const keyword of ALTERNATIVE_KEYWORDS) {
    const alternatives = schema[keyword];
    const notedAlternatives =
      alternatives === undefined ? null : noteAlternatives(alternatives, path, note, defs);
    if (notedAlternatives !== null) {
      noted[keyword] = notedAlternatives;
      reached = true;
    }
  }
  return reached ? noted : null;
}

function noteAlternatives(
  alternatives: readonly JsonSchema[],
  path: readonly string[],
  note: string,
  defs: Defs,
): JsonSchema[] | null {
  const noted = alternatives.map((alternative) => notePath(alternative, path, note, defs));
  if (noted.every((alternative) => alternative === null)) {
    return null;
  }
  return alternatives.map((alternative, index) => noted[index] ?? alternative);
}

function noteThroughRef(
  schema: JsonSchema,
  ref: string,
  path: readonly string[],
  note: string,
  defs: Defs,
): JsonSchema | null {
  if (!ref.startsWith(LOCAL_DEFS_PREFIX)) {
    throw new Error(`cannot note "${path.join(".")}" through $ref "${ref}"`);
  }
  const target = defs?.[decodePointer(ref.slice(LOCAL_DEFS_PREFIX.length))];
  if (target === undefined) {
    throw new Error(`$ref "${ref}" points at no $defs entry`);
  }
  const notedTarget = notePath(target, path, note, defs);
  if (notedTarget === null) {
    return null;
  }
  const { $ref: _inlined, ...siblings } = schema;
  return { ...siblings, allOf: [...(siblings.allOf ?? []), notedTarget] };
}

export function decodePointer(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

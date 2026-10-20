import { z, type ZodType } from "zod";

type JsonSchema = z.core.JSONSchema.BaseSchema;
type Io = "input" | "output";
type Override = NonNullable<z.core.ToJSONSchemaParams["override"]>;

interface JsonSchemaParams extends Pick<z.core.ToJSONSchemaParams, "reused" | "metadata"> {
  readonly io: Io;
}

const OPTIONALITY = { input: "optin", output: "optout" } as const;

export const REFINED_PREFIX = "refined: ";
const NOTE_SEPARATOR = "; ";

// The refinements here carry static messages, so the issue handed to the error map is never read.
const UNREPORTED_ISSUE = { code: "custom", input: undefined } as const;

// Zod writes a tuple with no minItems and an open rest, and drops every refinement, so a validator
// reading its JSON Schema accepts what the Zod schema refuses.
export function toJsonSchema(schema: ZodType, params: JsonSchemaParams): JsonSchema {
  return z.toJSONSchema(schema, { ...params, override: restoreDropped(params.io) });
}

function restoreDropped(io: Io): Override {
  return ({ zodSchema, jsonSchema }) => {
    if (zodSchema instanceof z.core.$ZodTuple) {
      restoreArity(zodSchema, jsonSchema, io);
    }
    noteRefinements(zodSchema, jsonSchema);
  };
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
  const notes = refinementMessages(schema).map((message) => `${REFINED_PREFIX}${message}`);
  if (notes.length === 0) {
    return;
  }
  const existing = json.description === undefined ? [] : [json.description];
  json.description = [...existing, ...notes].join(NOTE_SEPARATOR);
}

function refinementMessages(schema: z.core.$ZodType): string[] {
  const { checks } = schema._zod.def;
  if (checks === undefined) {
    return [];
  }
  return checks.flatMap((check) => {
    if (!(check instanceof z.core.$ZodCustom)) {
      return [];
    }
    const message = reportedMessage(check._zod.def.error?.(UNREPORTED_ISSUE));
    return message === null ? [] : [message];
  });
}

function reportedMessage(reported: ReturnType<z.core.$ZodErrorMap>): string | null {
  if (typeof reported === "string") {
    return reported;
  }
  return reported?.message ?? null;
}

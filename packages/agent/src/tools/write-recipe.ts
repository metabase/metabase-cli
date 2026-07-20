import { Type } from "typebox";
import { TeachingError } from "./teaching-error";

const WRITE_METHODS = ["create", "update"] as const;
const DELETABLE_WRITE_METHODS = ["create", "update", "delete"] as const;

export type WriteMethod = (typeof WRITE_METHODS)[number];
export type DeletableWriteMethod = (typeof DELETABLE_WRITE_METHODS)[number];
export type ToolWriteMethod = DeletableWriteMethod | "pull";

const REQUIREMENT_NOTE =
  "Per-method required fields are named in each parameter's description; supplying the wrong set returns a teaching error naming the missing field.";

export const methodSchema = Type.Unsafe<WriteMethod>({
  type: "string",
  enum: [...WRITE_METHODS],
  description: `\`create\` a new entity or \`update\` an existing one. ${REQUIREMENT_NOTE}`,
});

export const deletableMethodSchema = Type.Unsafe<DeletableWriteMethod>({
  type: "string",
  enum: [...DELETABLE_WRITE_METHODS],
  description: `\`create\` a new entity, \`update\` an existing one, or \`delete\` one. This resource has no trash: a \`delete\` is permanent and cannot be undone. ${REQUIREMENT_NOTE}`,
});

export interface MethodRequirementSpec<T> {
  pull?: readonly (keyof T)[];
  create?: readonly (keyof T)[];
  update?: readonly (keyof T)[];
  delete?: readonly (keyof T)[];
}

// A name is not an id. Without this, a model that only knows the entity's title retries the same
// nameless call until it gives up.
const ID_FIX =
  'An id is the entity\'s numeric id, not its name — look it up with `search`, `browse_collection`, or `browse_data` and pass the `id` you get back. To make a new entity instead, use `method: "create"`.';

// The call that carried a `name` believes the name addresses the entity; it must hear that the
// name is a payload field, and that the id it needs already passed through its own context.
const NAMED_ID_FIX =
  '`name` does not select an entity — on `update` it is the new title to write. Use the numeric `id` that came back in the result of the write that created it, or look it up with `search`, `browse_collection`, or `browse_data`. To make a new entity instead, use `method: "create"`.';

/**
 * What the call actually carried, read back to its sender. A model that believes it addressed an
 * entity — under a key this tool does not have, or in arguments that never arrived whole — repeats
 * the identical call against a message that only names the field; against its own arguments it
 * cannot.
 */
function carriedArguments(params: object): string {
  const keys = Object.entries(params)
    .filter(([, value]) => !isAbsent(value))
    .map(([key]) => `\`${key}\``);
  if (keys.length === 0) {
    return "This call carried no arguments at all.";
  }
  return `This call carried ${keys.join(", ")} and nothing else.`;
}

export function missingFieldError(
  method: string,
  fields: readonly string[],
  params: object,
): TeachingError {
  const names = fields.map((field) => `\`${field}\``).join(", ");
  const verb = fields.length === 1 ? "is" : "are";
  const needsId = method !== "create" && fields.includes("id");
  const fix = needsId ? ` ${carriesField(params, "name") ? NAMED_ID_FIX : ID_FIX}` : "";
  return new TeachingError(
    `${names} ${verb} required for the \`${method}\` method. ${carriedArguments(params)}${fix}`,
  );
}

function carriesField(params: object, field: string): boolean {
  return Object.entries(params).some(([key, value]) => key === field && !isAbsent(value));
}

export function assertMethodRequirements<T extends object>(
  method: ToolWriteMethod,
  params: T,
  spec: MethodRequirementSpec<T>,
): void {
  const required = spec[method];
  if (required === undefined) {
    return;
  }
  const missing = required.filter((key) => isAbsent(params[key])).map((key) => String(key));
  if (missing.length > 0) {
    throw missingFieldError(method, missing, params);
  }
}

export function assertExactlyOneOf<T>(
  params: T,
  fields: readonly (keyof T)[],
  sourceLabel: string,
): void {
  const provided = fields.filter((key) => !isAbsent(params[key]));
  if (provided.length === 1) {
    return;
  }
  const names = fields.map((key) => String(key)).join(", ");
  throw new TeachingError(
    `Provide exactly one ${sourceLabel} (${names}); received ${provided.length}.`,
  );
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

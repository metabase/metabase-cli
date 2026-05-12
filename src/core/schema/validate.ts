import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { z } from "zod";

import { isPlainObject } from "../../runtime/predicates";
import { ConfigError } from "../errors";
import { escapeJsonPointerSegment } from "../json-pointer";

import idSchema from "./data/schemas/common/id.json" with { type: "json" };
import parameterSchema from "./data/schemas/common/parameter.json" with { type: "json" };
import querySchema from "./data/schemas/common/query.json" with { type: "json" };
import refSchema from "./data/schemas/common/ref.json" with { type: "json" };
import temporalSchema from "./data/schemas/common/temporal_bucketing.json" with { type: "json" };

export const ValidationIssue = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationOutcome = z.object({
  ok: z.boolean(),
  errors: z.array(ValidationIssue),
});
export type ValidationOutcome = z.infer<typeof ValidationOutcome>;

// Internal MBQL is structurally identical to external MBQL except every ID
// field is a positive integer instead of a portable string / FK tuple. We
// override the bundled id.yaml's five $defs to express that.
const POSITIVE_INTEGER = { type: "integer", minimum: 1 } as const;
const internalIdSchema = {
  title: "ID (internal)",
  description: "Internal-MBQL identifier overrides — every ID is a positive integer.",
  $defs: {
    entity_id: POSITIVE_INTEGER,
    user_id: POSITIVE_INTEGER,
    database_id: POSITIVE_INTEGER,
    table_id: POSITIVE_INTEGER,
    field_id: POSITIVE_INTEGER,
  },
};

let externalValidator: ValidateFunction | null = null;
let internalValidator: ValidateFunction | null = null;

function buildAjv(idVariant: typeof idSchema | typeof internalIdSchema): ValidateFunction {
  const ajv = new Ajv2020({
    allErrors: true,
    strictTuples: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  ajv.addSchema(idVariant, "id.yaml");
  ajv.addSchema(parameterSchema, "parameter.yaml");
  ajv.addSchema(refSchema, "ref.yaml");
  ajv.addSchema(temporalSchema, "temporal_bucketing.yaml");
  ajv.addSchema(querySchema, "query.yaml");
  const compiled = ajv.getSchema("query.yaml");
  if (compiled === undefined) {
    throw new Error("internal: query.yaml validator not registered");
  }
  return compiled;
}

function getExternalValidator(): ValidateFunction {
  if (externalValidator === null) {
    externalValidator = buildAjv(idSchema);
  }
  return externalValidator;
}

function getInternalValidator(): ValidateFunction {
  if (internalValidator === null) {
    internalValidator = buildAjv(internalIdSchema);
  }
  return internalValidator;
}

export const UUID_HINT_MESSAGE =
  "must be a UUID v4 (RFC 4122) — run `metabase uuid` (or `metabase uuid --count N`) to mint one. The MBQL 5 schema rejects placeholder strings (`a1`, `uuid-1`, etc.); agents must call the CLI for UUIDs rather than authoring them.";

export const FIELD_SLOT1_HINT_MESSAGE =
  'must be the field options object — MBQL 5 field refs are ["field", {options}, fieldId]; the legacy MBQL 4 shape ["field", id, opts] is not accepted here. (Tip: `metabase uuid` mints `lib/uuid` strings if you need them.)';

export function clauseSlot1HintMessage(operator: string, slot1: unknown): string {
  return `must be the clause options object — every MBQL 5 clause is ["${operator}", {options}, ...args]; got ${describeJsonValue(slot1)} at index 1`;
}

const FormatErrorParams = z.object({ format: z.string() });

function isUuidFormatIssue(issue: ErrorObject): boolean {
  if (issue.keyword !== "format") {
    return false;
  }
  const parsed = FormatErrorParams.safeParse(issue.params);
  return parsed.success && parsed.data.format === "uuid";
}

function runValidator(validator: ValidateFunction, value: unknown): ValidationOutcome {
  if (validator(value)) {
    return { ok: true, errors: [] };
  }
  const overrides = collectMessageOverrides(value);
  const issues = validator.errors ?? [];
  const errors = issues.map((issue) => {
    if (issue.message === undefined) {
      throw new Error(`Ajv issue at ${issue.instancePath} has no message`);
    }
    const path = issue.instancePath === "" ? "/" : issue.instancePath;
    if (isUuidFormatIssue(issue)) {
      return { path, message: UUID_HINT_MESSAGE };
    }
    const overridden = overrides.get(path);
    return { path, message: overridden ?? issue.message };
  });
  return { ok: false, errors };
}

// Walks the candidate query and assembles per-path overrides for two common
// hand-authoring traps. Index 1 of every clause must be an options object
// (MBQL 5 puts opts second; the legacy MBQL 4 shape `[op, id, opts]` lands the
// id in this slot — Ajv just says "must be object", which doesn't tell the
// caller *why*). Index 2 of aggregation/expression refs must be a string
// (the target's lib/uuid or name); a numeric position there is the legacy
// position-index footgun.
function collectMessageOverrides(root: unknown): Map<string, string> {
  const overrides = new Map<string, string>();
  visit(root, "");
  return overrides;

  function visit(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      const slot1 = clauseSlot1Message(node);
      if (slot1 !== null) {
        overrides.set(`${path}/1`, slot1);
      }
      const slot2 = refSlot2Message(node);
      if (slot2 !== null) {
        overrides.set(`${path}/2`, slot2);
      }
      for (let index = 0; index < node.length; index += 1) {
        visit(node[index], `${path}/${index}`);
      }
      return;
    }
    if (!isPlainObject(node)) {
      return;
    }
    for (const key of Object.keys(node)) {
      visit(node[key], `${path}/${escapeJsonPointerSegment(key)}`);
    }
  }
}

function clauseSlot1Message(clause: readonly unknown[]): string | null {
  if (clause.length < 2) {
    return null;
  }
  const operator = clause[0];
  if (typeof operator !== "string") {
    return null;
  }
  const slot1 = clause[1];
  if (isPlainObject(slot1)) {
    return null;
  }
  if (operator === "field") {
    return FIELD_SLOT1_HINT_MESSAGE;
  }
  return clauseSlot1HintMessage(operator, slot1);
}

function refSlot2Message(clause: readonly unknown[]): string | null {
  if (clause.length !== 3) {
    return null;
  }
  const kind = clause[0];
  if (typeof kind !== "string") {
    return null;
  }
  if (typeof clause[2] === "string") {
    return null;
  }
  return refHintForKind(kind);
}

// Only `aggregation` and `expression` refs have unambiguously string-typed
// third elements. `metric`, `measure`, and `segment` refs accept entity ids
// that may be integer or string depending on the resource, so a "must be
// string" rewrite for those would mislead — leave Ajv's bare message alone.
function refHintForKind(kind: string): string | null {
  switch (kind) {
    case "aggregation": {
      return "must be the target aggregation's lib/uuid (string), not a numeric position";
    }
    case "expression": {
      return "must be the target expression's name (string), not a numeric position";
    }
    default: {
      return null;
    }
  }
}

function describeJsonValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "string") {
    return `string ${JSON.stringify(value)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${typeof value} ${String(value)}`;
  }
  return typeof value;
}

export function validateExternalQuery(value: unknown): ValidationOutcome {
  return runValidator(getExternalValidator(), value);
}

export function validateInternalQuery(value: unknown): ValidationOutcome {
  return runValidator(getInternalValidator(), value);
}

export function isMbql5Query(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "lib/type" in value && value["lib/type"] === "mbql/query";
}

// Detects the double-wrap footgun: an MBQL 5 query (`{lib/type: "mbql/query", …}`)
// nested inside a legacy MBQL 4 envelope (`{type: "query", database: N, query: {…}}`).
// The server stores this without complaint and only fails at run time with
// "Initial MBQL stage must have either :source-table or :source-card", because
// the legacy normalizer descends into `query` expecting legacy shape.
export function isLegacyEnvelopeWrappingMbql5(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (!("type" in value) || value["type"] !== "query") {
    return false;
  }
  if (!("query" in value)) {
    return false;
  }
  const inner = value["query"];
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    return false;
  }
  return "lib/type" in inner && inner["lib/type"] === "mbql/query";
}

// MBQL 5 native lives inside a stage (`stages[*].native`), never at the top
// level — the `isMbql5Query` guard keeps a well-formed MBQL 5 body out of this
// branch even if it carries a stray top-level `native` field.
export function isLegacyNativeQuery(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  if (isMbql5Query(value)) {
    return false;
  }
  return value["type"] === "native" || "native" in value;
}

export interface LegacyEnvelopeAssertOptions {
  readonly contextLabel: string;
  readonly bodyNoun: string;
}

export function assertNotLegacyEnvelopeWrappingMbql5(
  value: unknown,
  options: LegacyEnvelopeAssertOptions,
): void {
  if (!isLegacyEnvelopeWrappingMbql5(value)) {
    return;
  }
  throw new ConfigError(
    `${options.contextLabel}: MBQL 5 query nested inside a legacy {type:"query", query:…} envelope. ` +
      `For MBQL 5, ${options.bodyNoun} is the mbql/query value itself: ` +
      `{"lib/type":"mbql/query", database:N, stages:[…]}.`,
  );
}

export const SchemaMode = z.enum(["external", "internal"]);
export type SchemaMode = z.infer<typeof SchemaMode>;

export const QuerySchemaBundle = z.object({
  mode: SchemaMode,
  schema: z.unknown(),
  defs: z.object({
    "id.yaml": z.unknown(),
    "parameter.yaml": z.unknown(),
    "ref.yaml": z.unknown(),
    "temporal_bucketing.yaml": z.unknown(),
  }),
});
export type QuerySchemaBundle = z.infer<typeof QuerySchemaBundle>;

export function getQuerySchemaBundle(mode: SchemaMode): QuerySchemaBundle {
  return {
    mode,
    schema: querySchema,
    defs: {
      "id.yaml": mode === "internal" ? internalIdSchema : idSchema,
      "parameter.yaml": parameterSchema,
      "ref.yaml": refSchema,
      "temporal_bucketing.yaml": temporalSchema,
    },
  };
}

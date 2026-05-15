import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { z } from "zod";

import { isPlainObject } from "../../runtime/predicates";
import { ConfigError } from "../errors";
import { escapeJsonPointerSegment } from "../json-pointer";

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

// MBQL 5 IDs are always positive integers in the only endpoint the CLI talks to
// (`POST /api/dataset`). The bundled query.yaml `$ref`s id.yaml#/$defs/...; this
// override declares every id $def as a positive integer.
const POSITIVE_INTEGER = { type: "integer", minimum: 1 } as const;
const idSchema = {
  title: "ID",
  description: "MBQL identifier $defs — every id is a positive integer.",
  $defs: {
    entity_id: POSITIVE_INTEGER,
    user_id: POSITIVE_INTEGER,
    database_id: POSITIVE_INTEGER,
    table_id: POSITIVE_INTEGER,
    field_id: POSITIVE_INTEGER,
  },
};

let validator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
  if (validator !== null) {
    return validator;
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strictTuples: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  ajv.addSchema(idSchema, "id.yaml");
  ajv.addSchema(parameterSchema, "parameter.yaml");
  ajv.addSchema(refSchema, "ref.yaml");
  ajv.addSchema(temporalSchema, "temporal_bucketing.yaml");
  ajv.addSchema(querySchema, "query.yaml");
  const compiled = ajv.getSchema("query.yaml");
  if (compiled === undefined) {
    throw new Error("internal: query.yaml validator not registered");
  }
  validator = compiled;
  return validator;
}

export const UUID_HINT_MESSAGE =
  "must be a UUID v4 (RFC 4122) — run `mb uuid` (or `mb uuid --count N`) to mint one. The MBQL 5 schema rejects placeholder strings (`a1`, `uuid-1`, etc.); agents must call the CLI for UUIDs rather than authoring them.";

export const FIELD_SLOT1_HINT_MESSAGE =
  'must be the field options object — MBQL 5 field refs are ["field", {options}, fieldId]; the legacy MBQL 4 shape ["field", id, opts] is not accepted here. (Tip: `mb uuid` mints `lib/uuid` strings if you need them.)';

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

function runValidator(validatorFn: ValidateFunction, value: unknown): ValidationOutcome {
  if (validatorFn(value)) {
    return { ok: true, errors: [] };
  }
  const overrides = collectMessageOverrides(value);
  const issues = validatorFn.errors ?? [];
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

export function validateQuery(value: unknown): ValidationOutcome {
  return runValidator(getValidator(), value);
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

export const QuerySchemaBundle = z.object({
  schema: z.unknown(),
  defs: z.object({
    "id.yaml": z.unknown(),
    "parameter.yaml": z.unknown(),
    "ref.yaml": z.unknown(),
    "temporal_bucketing.yaml": z.unknown(),
  }),
});
export type QuerySchemaBundle = z.infer<typeof QuerySchemaBundle>;

export function getQuerySchemaBundle(): QuerySchemaBundle {
  return {
    schema: querySchema,
    defs: {
      "id.yaml": idSchema,
      "parameter.yaml": parameterSchema,
      "ref.yaml": refSchema,
      "temporal_bucketing.yaml": temporalSchema,
    },
  };
}

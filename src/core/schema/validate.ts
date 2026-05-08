import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { z } from "zod";

import { isPlainObject } from "../../runtime/predicates";

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

function runValidator(validator: ValidateFunction, value: unknown): ValidationOutcome {
  if (validator(value)) {
    return { ok: true, errors: [] };
  }
  const refHints = collectRefShapeHints(value);
  const issues = validator.errors ?? [];
  const errors = issues.map((issue) => {
    if (issue.message === undefined) {
      throw new Error(`Ajv issue at ${issue.instancePath} has no message`);
    }
    const path = issue.instancePath === "" ? "/" : issue.instancePath;
    const enrichedMessage = refHints.get(path);
    return { path, message: enrichedMessage ?? issue.message };
  });
  return { ok: false, errors };
}

// Walks the candidate query and identifies ref-clause arrays whose third
// element violates its kind-specific contract. Ajv reports these as bare
// "must be string", which doesn't tell the caller *which* string is meant
// (target aggregation's lib/uuid? expression's name?). We carry the kind in
// from the parent so the swapped message names the contract directly.
function collectRefShapeHints(root: unknown): Map<string, string> {
  const hints = new Map<string, string>();
  visit(root, "");
  return hints;

  function visit(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      const refMessage = refShapeMessage(node);
      if (refMessage !== null) {
        hints.set(`${path}/2`, refMessage);
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
      const segment = key.replace(/~/g, "~0").replace(/\//g, "~1");
      visit(node[key], `${path}/${segment}`);
    }
  }
}

function refShapeMessage(clause: readonly unknown[]): string | null {
  if (clause.length !== 3) {
    return null;
  }
  const kind = clause[0];
  if (typeof kind !== "string") {
    return null;
  }
  const hint = refHintForKind(kind);
  if (hint === null) {
    return null;
  }
  if (typeof clause[2] === "string") {
    return null;
  }
  return hint;
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

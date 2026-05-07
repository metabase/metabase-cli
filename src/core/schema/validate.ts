import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { z } from "zod";

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
  const issues = validator.errors ?? [];
  const errors = issues.map((issue) => {
    if (issue.message === undefined) {
      throw new Error(`Ajv issue at ${issue.instancePath} has no message`);
    }
    return {
      path: issue.instancePath === "" ? "/" : issue.instancePath,
      message: issue.message,
    };
  });
  return { ok: false, errors };
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

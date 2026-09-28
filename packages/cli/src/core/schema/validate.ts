import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { z } from "zod";

import { isPlainObject } from "@metabase/client/predicates";
import { ConfigError } from "@metabase/client/errors";
import { escapeJsonPointerSegment } from "@metabase/client/json-pointer";

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

// The bundled id.yaml $defs are looser than what a Metabase server accepts, so every id $def is
// overridden as a positive integer.
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

// The bundled metric, measure and segment refs name their target by serialization entity_id; over
// the API it is the numeric id.
function definitionRef(tag: string) {
  return {
    description: `[${tag}, options, id]`,
    type: "array",
    prefixItems: [{ const: tag }, { $ref: "query.yaml#/$defs/options" }, POSITIVE_INTEGER],
    minItems: 3,
    maxItems: 3,
  };
}

const refSchemaWithIds = {
  ...refSchema,
  $defs: {
    ...refSchema.$defs,
    metric_ref: definitionRef("metric"),
    measure_ref: definitionRef("measure"),
    segment_ref: definitionRef("segment"),
  },
};

// The bundled template tag demands a UUID id; the server takes any non-blank string.
const templateTag = querySchema.$defs.template_tag;

// The bundled native stage takes only the name-keyed map; the server also takes the list of tags it
// returns on read, so a native query read back from a card validates unchanged.
const nativeStage = querySchema.$defs.native_stage;
const TEMPLATE_TAG_REF = { $ref: "#/$defs/template_tag" } as const;
const querySchemaForApi = {
  ...querySchema,
  $defs: {
    ...querySchema.$defs,
    native_stage: {
      ...nativeStage,
      properties: {
        ...nativeStage.properties,
        "template-tags": {
          type: ["object", "array"],
          additionalProperties: TEMPLATE_TAG_REF,
          items: TEMPLATE_TAG_REF,
        },
      },
    },
    template_tag: {
      ...templateTag,
      properties: { ...templateTag.properties, id: { type: "string", minLength: 1 } },
    },
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
  ajv.addSchema(refSchemaWithIds, "ref.yaml");
  ajv.addSchema(temporalSchema, "temporal_bucketing.yaml");
  ajv.addSchema(querySchemaForApi, "query.yaml");
  const compiled = ajv.getSchema("query.yaml");
  if (compiled === undefined) {
    throw new Error("internal: query.yaml validator not registered");
  }
  validator = compiled;
  return validator;
}

export const UUID_HINT_MESSAGE = "must be a UUID from `mb uuid`";

export const FIELD_SLOT1_HINT_MESSAGE = 'must be the options object: ["field", {}, <field id>]';

export function clauseSlot1HintMessage(operator: string): string {
  return `must be the options object: ["${operator}", {}, ...args]`;
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
  const issues = (validatorFn.errors ?? []).filter((issue) => issue.keyword !== IF_KEYWORD);
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

// An if/then failure only restates the issue its `then` branch already reported at a deeper path.
const IF_KEYWORD = "if";

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
  return clauseSlot1HintMessage(operator);
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

// Only `aggregation` and `expression` refs take a string third element.
function refHintForKind(kind: string): string | null {
  switch (kind) {
    case "aggregation": {
      return "must be the lib/uuid of an aggregation in this stage";
    }
    case "expression": {
      return "must be the name of an expression in this stage";
    }
    default: {
      return null;
    }
  }
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

interface LegacyEnvelopeAssertOptions {
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
    `${options.contextLabel}: ${options.bodyNoun} is the query itself: ` +
      `{"lib/type": "mbql/query", "database": N, "stages": […]}.`,
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
    schema: querySchemaForApi,
    defs: {
      "id.yaml": idSchema,
      "parameter.yaml": parameterSchema,
      "ref.yaml": refSchemaWithIds,
      "temporal_bucketing.yaml": temporalSchema,
    },
  };
}

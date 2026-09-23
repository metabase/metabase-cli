import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { z } from "zod";

import { isPlainObject } from "@metabase/client/predicates";

import actionSchema from "./data/schemas/action.json" with { type: "json" };
import cardSchema from "./data/schemas/card.json" with { type: "json" };
import channelSchema from "./data/schemas/channel.json" with { type: "json" };
import collectionSchema from "./data/schemas/collection.json" with { type: "json" };
import idSchema from "./data/schemas/common/id.json" with { type: "json" };
import parameterSchema from "./data/schemas/common/parameter.json" with { type: "json" };
import querySchema from "./data/schemas/common/query.json" with { type: "json" };
import refSchema from "./data/schemas/common/ref.json" with { type: "json" };
import temporalSchema from "./data/schemas/common/temporal_bucketing.json" with { type: "json" };
import dashboardSchema from "./data/schemas/dashboard.json" with { type: "json" };
import databaseSchema from "./data/schemas/database.json" with { type: "json" };
import documentSchema from "./data/schemas/document.json" with { type: "json" };
import fieldUserSettingsSchema from "./data/schemas/field_user_settings.json" with { type: "json" };
import fieldValuesSchema from "./data/schemas/field_values.json" with { type: "json" };
import fieldSchema from "./data/schemas/field.json" with { type: "json" };
import glossarySchema from "./data/schemas/glossary.json" with { type: "json" };
import measureSchema from "./data/schemas/measure.json" with { type: "json" };
import metabotSchema from "./data/schemas/metabot.json" with { type: "json" };
import pythonLibrarySchema from "./data/schemas/python_library.json" with { type: "json" };
import segmentSchema from "./data/schemas/segment.json" with { type: "json" };
import snippetSchema from "./data/schemas/snippet.json" with { type: "json" };
import tableSchema from "./data/schemas/table.json" with { type: "json" };
import timelineSchema from "./data/schemas/timeline.json" with { type: "json" };
import transformJobSchema from "./data/schemas/transform_job.json" with { type: "json" };
import transformTagSchema from "./data/schemas/transform_tag.json" with { type: "json" };
import transformSchema from "./data/schemas/transform.json" with { type: "json" };
// The representation spec has no schema for it, and the sync script replaces `data/`.
import tableUserSettingsSchema from "./table_user_settings.json" with { type: "json" };
import { type ValidationIssue, type ValidationOutcome } from "./validate";

// The `$ref`s inside the vendored schemas name their targets by these ids.
const COMMON_SCHEMAS = {
  "common/id.yaml": idSchema,
  "common/parameter.yaml": parameterSchema,
  "common/query.yaml": querySchema,
  "common/ref.yaml": refSchema,
  "common/temporal_bucketing.yaml": temporalSchema,
} as const;

// Shapes other schemas reach through `$ref`, with no `serdes/meta` model of their own.
const SHARED_SCHEMAS = {
  "field_user_settings.yaml": fieldUserSettingsSchema,
  "field_values.yaml": fieldValuesSchema,
} as const;

// One schema per `serdes/meta[].model` value a file may carry.
export const ENTITY_SCHEMAS = {
  Action: actionSchema,
  Card: cardSchema,
  Channel: channelSchema,
  Collection: collectionSchema,
  Dashboard: dashboardSchema,
  Database: databaseSchema,
  Document: documentSchema,
  Field: fieldSchema,
  Glossary: glossarySchema,
  Measure: measureSchema,
  Metabot: metabotSchema,
  NativeQuerySnippet: snippetSchema,
  PythonLibrary: pythonLibrarySchema,
  Segment: segmentSchema,
  Table: tableSchema,
  TableUserSettings: tableUserSettingsSchema,
  Timeline: timelineSchema,
  Transform: transformSchema,
  TransformJob: transformJobSchema,
  TransformTag: transformTagSchema,
} as const;

export type EntityModel = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_MODELS: ReadonlyArray<EntityModel> =
  Object.keys(ENTITY_SCHEMAS).filter(isEntityModel);

export function isEntityModel(value: string): value is EntityModel {
  return Object.hasOwn(ENTITY_SCHEMAS, value);
}

const SerdesMetaEntry = z.object({ model: z.string() }).loose();
const SerdesMeta = z.array(SerdesMetaEntry).min(1);

interface ModelFound {
  kind: "found";
  model: EntityModel;
}

interface MetaMissing {
  kind: "missing-meta";
}

interface ModelUnknown {
  kind: "unknown-model";
  model: string;
}

type ModelLookup = ModelFound | MetaMissing | ModelUnknown;

// The last `serdes/meta` entry is the entity itself; the ones before it are its containers.
export function lookupModel(document: unknown): ModelLookup {
  if (!isPlainObject(document)) {
    return { kind: "missing-meta" };
  }
  const meta = SerdesMeta.safeParse(document["serdes/meta"]);
  if (!meta.success) {
    return { kind: "missing-meta" };
  }
  const last = meta.data[meta.data.length - 1];
  if (last === undefined) {
    return { kind: "missing-meta" };
  }
  return isEntityModel(last.model)
    ? { kind: "found", model: last.model }
    : { kind: "unknown-model", model: last.model };
}

let ajv: Ajv2020 | null = null;
const validators = new Map<EntityModel, ValidateFunction>();

function registry(): Ajv2020 {
  if (ajv !== null) {
    return ajv;
  }
  const instance = new Ajv2020({ allErrors: true, strictTuples: false, allowUnionTypes: true });
  addFormats(instance);
  for (const [id, schema] of Object.entries(COMMON_SCHEMAS)) {
    instance.addSchema(schema, id);
  }
  for (const [id, schema] of Object.entries(SHARED_SCHEMAS)) {
    instance.addSchema(schema, id);
  }
  ajv = instance;
  return instance;
}

function validatorFor(model: EntityModel): ValidateFunction {
  const cached = validators.get(model);
  if (cached !== undefined) {
    return cached;
  }
  const compiled = registry().compile(ENTITY_SCHEMAS[model]);
  validators.set(model, compiled);
  return compiled;
}

export function validateEntity(model: EntityModel, document: unknown): ValidationOutcome {
  const validate = validatorFor(model);
  if (validate(document)) {
    return { ok: true, errors: [] };
  }
  const errors: ValidationIssue[] = (validate.errors ?? []).map((issue) => {
    if (issue.message === undefined) {
      throw new Error(`Ajv issue at ${issue.instancePath} has no message`);
    }
    return { path: issue.instancePath === "" ? "/" : issue.instancePath, message: issue.message };
  });
  return { ok: false, errors };
}

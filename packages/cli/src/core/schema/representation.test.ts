import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseYaml } from "../../runtime/yaml";
import {
  ENTITY_MODELS,
  ENTITY_SCHEMAS,
  type EntityModel,
  isEntityModel,
  lookupModel,
  validateEntity,
} from "./representation";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const SCHEMAS_DIR = join(HERE, "data", "schemas");
const EXAMPLES_DIR = join(HERE, "examples");

const ENTITY_ID = "cOlMiNiMaL000ExAmPlx2";

function meta(model: string): Record<string, unknown> {
  return { "serdes/meta": [{ id: ENTITY_ID, model }] };
}

// The reference examples carry one file per model they cover; the models with no example get a
// minimal document built from the schema's required fields.
const HAND_WRITTEN: Record<string, Record<string, unknown>> = {
  Action: { name: "Refund", entity_id: ENTITY_ID, type: "query", ...meta("Action") },
  Database: { name: "Warehouse", ...meta("Database") },
  Field: {
    name: "TOTAL",
    base_type: "type/Float",
    database_type: "DOUBLE PRECISION",
    table_id: ["Warehouse", "public", "ORDERS"],
    ...meta("Field"),
  },
  Glossary: { term: "ARR", ...meta("Glossary") },
  Table: { name: "ORDERS", db_id: "Warehouse", ...meta("Table") },
  TableUserSettings: { fields: [], ...meta("TableUserSettings") },
  Timeline: { name: "Launches", entity_id: ENTITY_ID, ...meta("Timeline") },
};

function exampleFiles(): string[] {
  return readdirSync(EXAMPLES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();
}

function firstExampleOf(model: EntityModel): Record<string, unknown> | null {
  for (const file of exampleFiles()) {
    const document = parseYaml(readFileSync(file, "utf8"), z.record(z.string(), z.unknown()));
    const lookup = lookupModel(document);
    if (lookup.kind === "found" && lookup.model === model) {
      return document;
    }
  }
  return null;
}

function goodDocumentOf(model: EntityModel): Record<string, unknown> {
  const example = firstExampleOf(model) ?? HAND_WRITTEN[model];
  if (example === undefined) {
    throw new Error(`no fixture for ${model}`);
  }
  return example;
}

// The first required field after `serdes/meta` names what every entity of that kind must carry.
function firstRequiredOf(model: EntityModel): string {
  const required = z.array(z.string()).parse(ENTITY_SCHEMAS[model].required);
  const first = required.find((name) => name !== "serdes/meta");
  if (first === undefined) {
    throw new Error(`${model} requires nothing but serdes/meta`);
  }
  return first;
}

describe("the vendored schemas", () => {
  it("cover every entity schema file the sync script wrote, by model or as a shared shape", () => {
    const files = readdirSync(SCHEMAS_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/u, ""))
      .toSorted();
    expect(files).toEqual([
      "action",
      "card",
      "channel",
      "collection",
      "dashboard",
      "database",
      "document",
      "field",
      "field_user_settings",
      "field_values",
      "glossary",
      "measure",
      "metabot",
      "python_library",
      "segment",
      "snippet",
      "table",
      "timeline",
      "transform",
      "transform_job",
      "transform_tag",
    ]);
    expect([...ENTITY_MODELS].toSorted()).toEqual([
      "Action",
      "Card",
      "Channel",
      "Collection",
      "Dashboard",
      "Database",
      "Document",
      "Field",
      "Glossary",
      "Measure",
      "Metabot",
      "NativeQuerySnippet",
      "PythonLibrary",
      "Segment",
      "Table",
      "TableUserSettings",
      "Timeline",
      "Transform",
      "TransformJob",
      "TransformTag",
    ]);
  });

  it("accept every reference example", () => {
    const failures: string[] = [];
    for (const file of exampleFiles()) {
      const document = parseYaml(readFileSync(file, "utf8"), z.unknown());
      const lookup = lookupModel(document);
      if (lookup.kind !== "found") {
        failures.push(`${file}: ${lookup.kind}`);
        continue;
      }
      const outcome = validateEntity(lookup.model, document);
      if (!outcome.ok) {
        failures.push(`${file}: ${JSON.stringify(outcome.errors)}`);
      }
    }
    expect(exampleFiles()).toHaveLength(97);
    expect(failures).toEqual([]);
  });
});

describe.each(ENTITY_MODELS)("%s", (model) => {
  it("accepts a well-formed document", () => {
    expect(validateEntity(model, goodDocumentOf(model))).toEqual({ ok: true, errors: [] });
  });

  it("rejects a document missing a required field, naming it at the root pointer", () => {
    const { [firstRequiredOf(model)]: _dropped, ...rest } = goodDocumentOf(model);
    const outcome = validateEntity(model, rest);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({
      path: "/",
      message: `must have required property '${firstRequiredOf(model)}'`,
    });
  });
});

describe("validateEntity", () => {
  it("points at the offending value inside a nested field", () => {
    const document = { ...goodDocumentOf("Collection"), entity_id: "short" };
    expect(validateEntity("Collection", document)).toEqual({
      ok: false,
      errors: [{ path: "/entity_id", message: 'must match pattern "^[A-Za-z0-9_-]{21}$"' }],
    });
  });
});

describe("lookupModel", () => {
  it("reads the last serdes/meta entry, which is the entity itself", () => {
    expect(
      lookupModel({
        "serdes/meta": [
          { id: "d1", model: "Dashboard" },
          { id: "c1", model: "Card" },
        ],
      }),
    ).toEqual({ kind: "found", model: "Card" });
  });

  it("reports a document without serdes/meta, an empty one, and a non-object", () => {
    expect(lookupModel({ name: "x" })).toEqual({ kind: "missing-meta" });
    expect(lookupModel({ "serdes/meta": [] })).toEqual({ kind: "missing-meta" });
    expect(lookupModel("text")).toEqual({ kind: "missing-meta" });
  });

  it("reports a model no schema covers", () => {
    expect(lookupModel(meta("DashboardCard"))).toEqual({
      kind: "unknown-model",
      model: "DashboardCard",
    });
    expect(isEntityModel("DashboardCard")).toBe(false);
  });
});

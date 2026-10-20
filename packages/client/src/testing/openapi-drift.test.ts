import { describe, expect, it } from "vitest";

import { FieldUpdateInput } from "../domain/field";
import { MeasureCreateInput } from "../domain/measure";
import { TableUpdateInput } from "../domain/table";
import type { FeatureName } from "../version/features";
import { type BodyRoute, OpenApiBodies, openApiDrift } from "./openapi-drift";

const FIELD_UPDATE: BodyRoute = {
  key: "field.update",
  method: "PUT",
  path: "/api/field/{}",
  input: FieldUpdateInput,
};

const TABLE_UPDATE: BodyRoute = {
  key: "table.update",
  method: "PUT",
  path: "/api/table/{}",
  input: TableUpdateInput,
};

const MEASURE_CREATE: BodyRoute = {
  key: "measure.create",
  method: "POST",
  path: "/api/measure",
  input: MeasureCreateInput,
};

type OperationKey = "put" | "post";

const FIELD_UPDATE_FIELDS = Object.keys(FieldUpdateInput.shape);
const MEASURE_CREATE_FIELDS_BUT_TABLE = Object.keys(MeasureCreateInput.shape).filter(
  (field) => field !== "table_id",
);
const BODY_COMPONENT = "update-body";

function holdsEvery(): boolean {
  return true;
}

function lacks(missing: FeatureName): (feature: FeatureName) => boolean {
  return (feature) => feature !== missing;
}

function propertiesOf(fields: readonly string[]): Record<string, object> {
  return Object.fromEntries(fields.map((field) => [field, {}]));
}

function specDeclaring(
  path: string,
  fields: readonly string[],
  operation: OperationKey = "put",
): OpenApiBodies {
  const half = Math.ceil(fields.length / 2);
  return OpenApiBodies.parse({
    paths: {
      [path]: {
        [operation]: {
          requestBody: {
            content: {
              "application/json": { schema: { $ref: `#/components/schemas/${BODY_COMPONENT}` } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        [BODY_COMPONENT]: {
          allOf: [
            { properties: propertiesOf(fields.slice(0, half)) },
            { properties: propertiesOf(fields.slice(half)) },
          ],
        },
      },
    },
  });
}

function fieldUpdateWithout(field: string): readonly string[] {
  return FIELD_UPDATE_FIELDS.filter((declared) => declared !== field);
}

describe("openApiDrift", () => {
  it("finds no drift when the server declares every field of the input", () => {
    const spec = specDeclaring("/api/field/{id}", FIELD_UPDATE_FIELDS);

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("names a field the server's body does not declare", () => {
    const spec = specDeclaring("/api/field/{id}", fieldUpdateWithout("description"));

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [{ key: "field.update", field: "description" }],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("excuses a field gated on its presence when the server lacks the gate's feature", () => {
    const spec = specDeclaring("/api/field/{id}", fieldUpdateWithout("data_sensitivity"));

    expect(openApiDrift(spec, [FIELD_UPDATE], lacks("fieldDataSensitivity"))).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [
        { key: "field.update", field: "data_sensitivity", feature: "fieldDataSensitivity" },
      ],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("names a field gated on its presence when the server holds the gate's feature", () => {
    const spec = specDeclaring("/api/field/{id}", fieldUpdateWithout("data_sensitivity"));

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [{ key: "field.update", field: "data_sensitivity" }],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("excuses a field a server drops when it holds the feature that drops it", () => {
    const spec = specDeclaring("/api/measure", MEASURE_CREATE_FIELDS_BUT_TABLE, "post");

    expect(openApiDrift(spec, [MEASURE_CREATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [{ key: "measure.create", field: "table_id", feature: "tableFromDefinition" }],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("names a field a server drops when it lacks the feature that drops it", () => {
    const spec = specDeclaring("/api/measure", MEASURE_CREATE_FIELDS_BUT_TABLE, "post");

    expect(openApiDrift(spec, [MEASURE_CREATE], lacks("tableFromDefinition"))).toEqual({
      missingRoutes: [],
      missing: [{ key: "measure.create", field: "table_id" }],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("names a field gated only on some of its values even when the server lacks the feature", () => {
    const fields = Object.keys(TableUpdateInput.shape).filter((field) => field !== "data_layer");
    const spec = specDeclaring("/api/table/{id}", fields);

    expect(openApiDrift(spec, [TABLE_UPDATE], lacks("tableDataLayerTiers"))).toEqual({
      missingRoutes: [],
      missing: [{ key: "table.update", field: "data_layer" }],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("lists a field the server declares and the input lacks as an extra", () => {
    const spec = specDeclaring("/api/field/{id}", [...FIELD_UPDATE_FIELDS, "custom_position"]);

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [],
      extras: [{ key: "field.update", fields: ["custom_position"] }],
      unchecked: [],
      checked: 1,
    });
  });

  it("matches a document path whose parameter has another name and a trailing slash", () => {
    const spec = specDeclaring("/api/field/{field-id}/", FIELD_UPDATE_FIELDS);

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 1,
    });
  });

  it("leaves a body that names no property unchecked", () => {
    const spec = OpenApiBodies.parse({
      paths: {
        "/api/field/{id}": {
          put: { requestBody: { content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
      components: { schemas: {} },
    });

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [],
      extras: [],
      unchecked: [{ key: "field.update", reason: "openBody" }],
      checked: 0,
    });
  });

  it("leaves an operation without a JSON body unchecked", () => {
    const spec = OpenApiBodies.parse({
      paths: { "/api/field/{id}": { put: {} } },
      components: { schemas: {} },
    });

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: [],
      missing: [],
      excused: [],
      extras: [],
      unchecked: [{ key: "field.update", reason: "noJsonBody" }],
      checked: 0,
    });
  });

  it("names a route the document does not declare", () => {
    const spec = specDeclaring("/api/table/{id}", FIELD_UPDATE_FIELDS);

    expect(openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toEqual({
      missingRoutes: ["field.update"],
      missing: [],
      excused: [],
      extras: [],
      unchecked: [],
      checked: 0,
    });
  });

  it("refuses a route two document paths declare the same operation for", () => {
    const spec = OpenApiBodies.parse({
      paths: { "/api/field/{id}": { put: {} }, "/api/field/{field-id}": { put: {} } },
      components: { schemas: {} },
    });

    expect(() => openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toThrow(
      new Error(
        "OpenAPI paths /api/field/{id}, /api/field/{field-id} all declare put /api/field/{}",
      ),
    );
  });

  it("refuses a body whose $ref names no component schema", () => {
    const spec = OpenApiBodies.parse({
      paths: {
        "/api/field/{id}": {
          put: {
            requestBody: {
              content: { "application/json": { schema: { $ref: "#/components/schemas/absent" } } },
            },
          },
        },
      },
      components: { schemas: {} },
    });

    expect(() => openApiDrift(spec, [FIELD_UPDATE], holdsEvery)).toThrow(
      new Error("OpenAPI $ref #/components/schemas/absent names no component schema"),
    );
  });
});

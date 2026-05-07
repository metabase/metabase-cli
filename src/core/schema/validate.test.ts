import { describe, expect, it } from "vitest";

import {
  getQuerySchemaBundle,
  isMbql5Query,
  validateExternalQuery,
  validateInternalQuery,
} from "./validate";

const VALID_EXTERNAL = {
  "lib/type": "mbql/query",
  database: "My DB",
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": ["My DB", null, "orders"],
    },
  ],
};

const VALID_INTERNAL = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": 7,
    },
  ],
};

describe("validateExternalQuery", () => {
  it("accepts a structurally valid external-MBQL body", () => {
    expect(validateExternalQuery(VALID_EXTERNAL)).toEqual({ ok: true, errors: [] });
  });

  it("rejects integer database (would belong to internal MBQL)", () => {
    expect(validateExternalQuery(VALID_INTERNAL)).toEqual({
      ok: false,
      errors: [
        { path: "/database", message: "must be string" },
        { path: "/stages/0/source-table", message: "must be array" },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
  });

  it("rejects an empty stages array", () => {
    expect(
      validateExternalQuery({
        "lib/type": "mbql/query",
        database: "My DB",
        stages: [],
      }),
    ).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
  });

  it("rejects a missing top-level lib/type", () => {
    const outcome = validateExternalQuery({
      database: "My DB",
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": ["My DB", null, "orders"] }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({
      path: "/",
      message: "must have required property 'lib/type'",
    });
  });
});

describe("validateInternalQuery", () => {
  it("accepts a structurally valid internal-MBQL body", () => {
    expect(validateInternalQuery(VALID_INTERNAL)).toEqual({ ok: true, errors: [] });
  });

  it("rejects string database / FK-tuple source-table (would belong to external MBQL)", () => {
    expect(validateInternalQuery(VALID_EXTERNAL)).toEqual({
      ok: false,
      errors: [
        { path: "/database", message: "must be integer" },
        { path: "/stages/0/source-table", message: "must be integer" },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
  });

  it("rejects zero or negative database id", () => {
    const outcome = validateInternalQuery({
      "lib/type": "mbql/query",
      database: 0,
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({ path: "/database", message: "must be >= 1" });
  });
});

describe("isMbql5Query", () => {
  it("returns true for an object with lib/type: mbql/query", () => {
    expect(isMbql5Query({ "lib/type": "mbql/query" })).toBe(true);
  });

  it("returns false for an object with a different lib/type", () => {
    expect(isMbql5Query({ "lib/type": "mbql.stage/mbql" })).toBe(false);
  });

  it("returns false for an object missing lib/type", () => {
    expect(isMbql5Query({ type: "query", database: 1, query: { "source-table": 7 } })).toBe(false);
  });

  it("returns false for null, primitives, and arrays", () => {
    expect(isMbql5Query(null)).toBe(false);
    expect(isMbql5Query(undefined)).toBe(false);
    expect(isMbql5Query("mbql/query")).toBe(false);
    expect(isMbql5Query(42)).toBe(false);
    expect(isMbql5Query([{ "lib/type": "mbql/query" }])).toBe(false);
  });
});

describe("getQuerySchemaBundle", () => {
  it("external mode bundles the query schema with the string-FK id schema and the other 3 common defs", () => {
    const bundle = getQuerySchemaBundle("external");
    expect(bundle.mode).toBe("external");
    expect(bundle.schema).toBe(getQuerySchemaBundle("external").schema);
    expect(Object.keys(bundle.defs)).toEqual([
      "id.yaml",
      "parameter.yaml",
      "ref.yaml",
      "temporal_bucketing.yaml",
    ]);
  });

  it("external mode's id schema describes database_id as a string", () => {
    const bundle = getQuerySchemaBundle("external");
    expect(bundle.defs["id.yaml"]).toMatchObject({
      $defs: { database_id: { type: "string" } },
    });
  });

  it("internal mode's id schema describes every id $def as a positive integer", () => {
    const bundle = getQuerySchemaBundle("internal");
    expect(bundle.mode).toBe("internal");
    expect(bundle.defs["id.yaml"]).toEqual({
      title: "ID (internal)",
      description: "Internal-MBQL identifier overrides — every ID is a positive integer.",
      $defs: {
        entity_id: { type: "integer", minimum: 1 },
        user_id: { type: "integer", minimum: 1 },
        database_id: { type: "integer", minimum: 1 },
        table_id: { type: "integer", minimum: 1 },
        field_id: { type: "integer", minimum: 1 },
      },
    });
  });
});

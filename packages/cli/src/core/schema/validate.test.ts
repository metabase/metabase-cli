import { describe, expect, it } from "vitest";

import {
  FIELD_SLOT1_HINT_MESSAGE,
  UUID_HINT_MESSAGE,
  clauseSlot1HintMessage,
  getQuerySchemaBundle,
  isLegacyEnvelopeWrappingMbql5,
  isMbql5Query,
  validateQuery,
} from "./validate";

const VALID_QUERY = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [
    {
      "lib/type": "mbql.stage/mbql",
      "source-table": 7,
    },
  ],
};

describe("validateQuery", () => {
  it("accepts a structurally valid MBQL 5 body", () => {
    expect(validateQuery(VALID_QUERY)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a string database id / FK-tuple source-table (only positive integers are accepted)", () => {
    expect(
      validateQuery({
        "lib/type": "mbql/query",
        database: "My DB",
        stages: [
          {
            "lib/type": "mbql.stage/mbql",
            "source-table": ["My DB", null, "orders"],
          },
        ],
      }),
    ).toEqual({
      ok: false,
      errors: [
        { path: "/database", message: "must be integer" },
        { path: "/stages/0/source-table", message: "must be integer" },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
  });

  it("rejects zero or negative database id", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 0,
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({ path: "/database", message: "must be >= 1" });
  });

  it("rejects an empty stages array", () => {
    expect(
      validateQuery({
        "lib/type": "mbql/query",
        database: 1,
        stages: [],
      }),
    ).toEqual({
      ok: false,
      errors: [{ path: "/stages", message: "must NOT have fewer than 1 items" }],
    });
  });

  it("rejects a missing top-level lib/type", () => {
    const outcome = validateQuery({
      database: 1,
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({
      path: "/",
      message: "must have required property 'lib/type'",
    });
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

describe("isLegacyEnvelopeWrappingMbql5", () => {
  it("returns true for an MBQL 5 query nested inside a legacy MBQL 4 envelope", () => {
    expect(
      isLegacyEnvelopeWrappingMbql5({
        type: "query",
        database: 2,
        query: { "lib/type": "mbql/query", database: 2, stages: [] },
      }),
    ).toBe(true);
  });

  it("returns false for a plain legacy MBQL 4 envelope", () => {
    expect(
      isLegacyEnvelopeWrappingMbql5({ type: "query", database: 2, query: { "source-table": 7 } }),
    ).toBe(false);
  });

  it("returns false for a top-level MBQL 5 query", () => {
    expect(isLegacyEnvelopeWrappingMbql5(VALID_QUERY)).toBe(false);
  });

  it("returns false for non-objects, arrays, and null", () => {
    expect(isLegacyEnvelopeWrappingMbql5(null)).toBe(false);
    expect(isLegacyEnvelopeWrappingMbql5("query")).toBe(false);
    expect(isLegacyEnvelopeWrappingMbql5([])).toBe(false);
    expect(
      isLegacyEnvelopeWrappingMbql5({ type: "native", query: { "lib/type": "mbql/query" } }),
    ).toBe(false);
  });
});

describe("ref-clause error messages", () => {
  it("rewrites 'must be string' on aggregation_ref's UUID slot and reports the cascading 'then' shape errors verbatim", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/mbql",
          "source-table": 7,
          aggregations: [["count", { "lib/uuid": "11111111-1111-1111-1111-111111111111" }]],
          "order-by": [
            [
              "asc",
              { "lib/uuid": "22222222-2222-2222-2222-222222222222" },
              ["aggregation", { "lib/uuid": "33333333-3333-3333-3333-333333333333" }, 0],
            ],
          ],
        },
      ],
    });
    expect(outcome).toEqual({
      ok: false,
      errors: [
        {
          path: "/stages/0/order-by/0/2/2",
          message: "must be the target aggregation's lib/uuid (string), not a numeric position",
        },
        { path: "/stages/0/order-by/0/2", message: 'must match "then" schema' },
        { path: "/stages/0/order-by/0/2", message: 'must match "then" schema' },
        { path: "/stages/0/order-by/0", message: 'must match "then" schema' },
        { path: "/stages/0/order-by/0", message: 'must match "then" schema' },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
  });

  it("rewrites the message for expression refs to reference the name contract", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/mbql",
          "source-table": 7,
          fields: [["expression", { "lib/uuid": "44444444-4444-4444-4444-444444444444" }, 0]],
        },
      ],
    });
    expect(outcome).toEqual({
      ok: false,
      errors: [
        {
          path: "/stages/0/fields/0/2",
          message: "must be the target expression's name (string), not a numeric position",
        },
        { path: "/stages/0/fields/0", message: 'must match "then" schema' },
        { path: "/stages/0", message: 'must match "then" schema' },
      ],
    });
  });

  it("does not rewrite non-string-typed errors (only 'must be string' at ref-third positions is enriched)", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: "oops",
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
    });
    expect(outcome).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
  });
});

describe("clause-shape error messages", () => {
  it("rewrites 'must be object' at /1 of a `field` clause to call out the MBQL5 vs MBQL4 ordering trap", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/mbql",
          "source-table": 7,
          breakout: [
            [
              "field",
              86,
              { "lib/uuid": "55555555-5555-5555-5555-555555555555", "base-type": "type/Text" },
            ],
          ],
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({
      path: "/stages/0/breakout/0/1",
      message: FIELD_SLOT1_HINT_MESSAGE,
    });
  });

  it("rewrites 'must be object' at /1 of an arbitrary clause with a generic options-position message that names the operator and the offending value", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/mbql",
          "source-table": 7,
          aggregation: [["sum", "not-an-object", ["field", {}, 86]]],
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({
      path: "/stages/0/aggregation/0/1",
      message: clauseSlot1HintMessage("sum", "not-an-object"),
    });
  });

  it("does not override slot 1 when the operator is not a string (the array isn't a clause)", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 1,
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": [1, 2, 3] }],
    });
    expect(outcome.ok).toBe(false);
    for (const issue of outcome.errors) {
      expect(issue.message).not.toContain("clause options object");
      expect(issue.message).not.toContain("field options object");
    }
  });
});

describe("uuid-format error messages", () => {
  it("replaces Ajv's bare 'must match format \"uuid\"' with a hint pointing at `mb uuid`", () => {
    const outcome = validateQuery({
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/mbql",
          "source-table": 7,
          aggregation: [["count", { "lib/uuid": "a1" }]],
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toContainEqual({
      path: "/stages/0/aggregation/0/1/lib~1uuid",
      message: UUID_HINT_MESSAGE,
    });
  });

  it("uuid hint string mentions `mb uuid` and notes that placeholders are rejected", () => {
    expect(UUID_HINT_MESSAGE).toContain("mb uuid");
    expect(UUID_HINT_MESSAGE).toContain("placeholder");
  });
});

describe("getQuerySchemaBundle", () => {
  it("bundles the query schema with the 4 common defs and pins every id $def to a positive integer", () => {
    const bundle = getQuerySchemaBundle();
    expect(Object.keys(bundle.defs)).toEqual([
      "id.yaml",
      "parameter.yaml",
      "ref.yaml",
      "temporal_bucketing.yaml",
    ]);
    expect(bundle.defs["id.yaml"]).toEqual({
      title: "ID",
      description: "MBQL identifier $defs — every id is a positive integer.",
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

import { expect, test } from "vitest";
import { ZodError } from "zod";
import { buildNativeQuery, tagOccurrences } from "./native-query";
import { TeachingError, toTeachingError } from "./teaching-error";

test("wraps SQL in an MBQL 5 native stage", () => {
  expect(buildNativeQuery({ database_id: 1, sql: "SELECT 1" })).toEqual({
    "lib/type": "mbql/query",
    database: 1,
    stages: [{ "lib/type": "mbql.stage/native", native: "SELECT 1" }],
  });
});

test("mints a stable id, name, and display name for each declared tag", () => {
  const query = buildNativeQuery({
    database_id: 1,
    sql: "SELECT * FROM orders WHERE {{state}} AND total > {{min_total}}",
    template_tags: {
      state: { type: "dimension", dimension: ["field", {}, 1779], "widget-type": "string/=" },
      min_total: { type: "number" },
    },
  });

  expect(query).toEqual({
    "lib/type": "mbql/query",
    database: 1,
    stages: [
      {
        "lib/type": "mbql.stage/native",
        native: "SELECT * FROM orders WHERE {{state}} AND total > {{min_total}}",
        "template-tags": {
          state: {
            id: "4ba69735-ca53-765e-d6a7-09edb56c6ea2",
            name: "state",
            "display-name": "State",
            type: "dimension",
            dimension: ["field", {}, 1779],
            "widget-type": "string/=",
          },
          min_total: {
            id: "a26dbd41-7944-7187-6cda-467abbc6a80b",
            name: "min_total",
            "display-name": "Min Total",
            type: "number",
          },
        },
      },
    ],
  });
});

test("the same card body writes byte-identically twice", () => {
  const build = () =>
    buildNativeQuery({
      database_id: 1,
      sql: "SELECT {{a}}",
      template_tags: { a: { type: "text" } },
    });

  expect(build()).toEqual({
    "lib/type": "mbql/query",
    database: 1,
    stages: [
      {
        "lib/type": "mbql.stage/native",
        native: "SELECT {{a}}",
        "template-tags": {
          a: {
            id: "ca978112-ca1b-bdca-fac2-31b39a23dc4d",
            name: "a",
            "display-name": "A",
            type: "text",
          },
        },
      },
    ],
  });
  expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
});

test("a caller-supplied id, name, and display name win over the minted ones", () => {
  const query = buildNativeQuery({
    database_id: 1,
    sql: "SELECT {{a}}",
    template_tags: {
      a: { type: "text", id: "fixed", name: "a", "display-name": "The A" },
    },
  });

  expect(query).toEqual({
    "lib/type": "mbql/query",
    database: 1,
    stages: [
      {
        "lib/type": "mbql.stage/native",
        native: "SELECT {{a}}",
        "template-tags": {
          a: { id: "fixed", name: "a", "display-name": "The A", type: "text" },
        },
      },
    ],
  });
});

test("a {{tag}} with no declaration is a teaching error naming both tag kinds", () => {
  expect(() =>
    buildNativeQuery({
      database_id: 1,
      sql: "SELECT * FROM orders WHERE {{state}} AND total > {{min_total}}",
      template_tags: { state: { type: "dimension" } },
    }),
  ).toThrow(
    new TeachingError(
      'The SQL references {{min_total}} but `native.template_tags` declares no entry for it. Every {{tag}} needs a tag body — a bare `{{x}}` filtering a real column is a field filter (`{"type": "dimension", "dimension": ["field", {}, <field-id>], "widget-type": "string/="}`); a value spliced into an expression is a raw variable (`{"type": "text"}`).',
    ),
  );
});

test("a declared tag the SQL never uses is a teaching error", () => {
  expect(() =>
    buildNativeQuery({
      database_id: 1,
      sql: "SELECT 1",
      template_tags: { state: { type: "text" } },
    }),
  ).toThrow(
    new TeachingError(
      "`native.template_tags` declares {{state}} but the SQL never references it. Add the {{tag}} to the SQL or drop the declaration.",
    ),
  );
});

test("an unknown tag type is rejected before the request leaves", () => {
  const build = () =>
    buildNativeQuery({
      database_id: 1,
      sql: "SELECT {{a}}",
      template_tags: { a: { type: "widget" } },
    });

  expect(build).toThrow(ZodError);
  expect(toTeachingError(catchError(build)).message).toBe(
    'a.type: Invalid option: expected one of "text"|"number"|"date"|"boolean"|"dimension"|"snippet"|"card"',
  );
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

test("snippet and card-reference tags are named by their whole placeholder", () => {
  expect(
    tagOccurrences("SELECT * FROM {{#42-orders}} WHERE {{snippet: Active Rows}} AND x > {{n}}"),
  ).toEqual(new Set(["#42-orders", "snippet: Active Rows", "n"]));
});

test("an optional block's tag still counts as used", () => {
  expect(tagOccurrences("SELECT 1 WHERE true [[AND {{status}}]]")).toEqual(new Set(["status"]));
});

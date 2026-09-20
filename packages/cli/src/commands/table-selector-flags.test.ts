import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import type { TableSelectors } from "@metabase/client/domain/table";

import { parseTableSelectors } from "./table-selector-flags";

type SelectorArgs = Parameters<typeof parseTableSelectors>[0];

function parse(overrides: Partial<SelectorArgs>): TableSelectors {
  return parseTableSelectors({
    "table-ids": undefined,
    "db-ids": undefined,
    schemas: undefined,
    ...overrides,
  });
}

describe("parseTableSelectors", () => {
  it("parses each selector flag into its API field, skipping the ones not given", () => {
    expect(parse({ "table-ids": "3,1,2" })).toEqual({ table_ids: [3, 1, 2] });
    expect(parse({ "db-ids": "7" })).toEqual({ database_ids: [7] });
    expect(parse({ schemas: "1:public,1:analytics" })).toEqual({
      schema_ids: ["1:public", "1:analytics"],
    });
  });

  it("combines all three selectors and trims surrounding whitespace", () => {
    expect(
      parse({
        "table-ids": " 1 , 2 ",
        "db-ids": "5",
        schemas: " 1:public , 1:sales ",
      }),
    ).toEqual({
      table_ids: [1, 2],
      database_ids: [5],
      schema_ids: ["1:public", "1:sales"],
    });
  });

  it("throws ConfigError when no selector is provided", () => {
    expect(() => parse({})).toThrow(
      new ConfigError("provide at least one selector: --table-ids, --db-ids, or --schemas"),
    );
  });

  it("throws ConfigError when selectors are present but empty after splitting", () => {
    expect(() => parse({ "table-ids": " , ", schemas: "" })).toThrow(
      new ConfigError("provide at least one selector: --table-ids, --db-ids, or --schemas"),
    );
  });

  it("rejects a non-integer table id with the parseId message", () => {
    expect(() => parse({ "table-ids": "1,abc" })).toThrow(
      new ConfigError('invalid table id: "abc" (expected integer)'),
    );
  });

  it("rejects a non-positive database id with the parseId message", () => {
    expect(() => parse({ "db-ids": "0" })).toThrow(
      new ConfigError("invalid database id: 0 (must be ≥ 1)"),
    );
  });
});

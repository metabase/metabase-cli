import { describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";

import { parseTableSelectors } from "./selectors";

describe("parseTableSelectors", () => {
  it("parses each selector flag into its API field, skipping the ones not given", () => {
    expect(parseTableSelectors({ "table-ids": "3,1,2" })).toEqual({ table_ids: [3, 1, 2] });
    expect(parseTableSelectors({ "db-ids": "7" })).toEqual({ database_ids: [7] });
    expect(parseTableSelectors({ schemas: "1:public,1:analytics" })).toEqual({
      schema_ids: ["1:public", "1:analytics"],
    });
  });

  it("combines all three selectors and trims surrounding whitespace", () => {
    expect(
      parseTableSelectors({
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
    expect(() => parseTableSelectors({})).toThrow(
      new ConfigError("provide at least one selector: --table-ids, --db-ids, or --schemas"),
    );
  });

  it("throws ConfigError when selectors are present but empty after splitting", () => {
    expect(() => parseTableSelectors({ "table-ids": " , ", schemas: "" })).toThrow(
      new ConfigError("provide at least one selector: --table-ids, --db-ids, or --schemas"),
    );
  });

  it("rejects a non-integer table id with the parseId message", () => {
    expect(() => parseTableSelectors({ "table-ids": "1,abc" })).toThrow(
      new ConfigError('invalid table id: "abc" (expected integer)'),
    );
  });

  it("rejects a non-positive database id with the parseId message", () => {
    expect(() => parseTableSelectors({ "db-ids": "0" })).toThrow(
      new ConfigError("invalid database id: 0 (must be ≥ 1)"),
    );
  });
});

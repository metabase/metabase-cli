import { describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";

import { parseColumnList, parseInputPairs, parseTargetType } from "./subgraph";

describe("parseInputPairs", () => {
  it("parses comma-separated <id>=<path> pairs", () => {
    expect(parseInputPairs("229=orders.csv,223=people.csv")).toEqual([
      { tableId: 229, path: "orders.csv" },
      { tableId: 223, path: "people.csv" },
    ]);
  });

  it("returns an empty array for undefined or blank input", () => {
    expect(parseInputPairs(undefined)).toEqual([]);
    expect(parseInputPairs("   ")).toEqual([]);
  });

  it("trims whitespace around entries and around each side of '='", () => {
    expect(parseInputPairs(" 1 = a.csv , 2 = b.csv ")).toEqual([
      { tableId: 1, path: "a.csv" },
      { tableId: 2, path: "b.csv" },
    ]);
  });

  it("throws ConfigError with the offending entry when '=' is missing", () => {
    expect(() => parseInputPairs("229")).toThrow(ConfigError);
    expect(() => parseInputPairs("229")).toThrow(
      "Malformed --input entry '229'. Expected <table-id>=<file> (e.g. 229=orders.csv).",
    );
  });

  it("throws ConfigError when the table id is not a positive integer", () => {
    expect(() => parseInputPairs("0=x.csv")).toThrow(ConfigError);
    expect(() => parseInputPairs("0=x.csv")).toThrow("invalid --input table id: 0 (must be ≥ 1)");
  });
});

describe("parseColumnList", () => {
  it("splits and trims comma-separated names", () => {
    expect(parseColumnList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for undefined or blank input", () => {
    expect(parseColumnList(undefined)).toEqual([]);
    expect(parseColumnList("")).toEqual([]);
  });
});

describe("parseTargetType", () => {
  it("accepts the supported target types", () => {
    expect(parseTargetType("transform")).toBe("transform");
    expect(parseTargetType("card")).toBe("card");
  });

  it("throws ConfigError naming the supported types for an unsupported value", () => {
    expect(() => parseTargetType("metric")).toThrow(ConfigError);
    expect(() => parseTargetType("metric")).toThrow(
      'invalid --target-type: "metric" (expected one of: transform, card)',
    );
  });
});

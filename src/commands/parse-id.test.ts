import { describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";

import { parseIdCsv } from "./parse-id";

describe("parseIdCsv", () => {
  it("parses a comma-separated list, trimming whitespace", () => {
    expect(parseIdCsv("1, 2,3", "database id")).toEqual([1, 2, 3]);
  });

  it("parses a single id", () => {
    expect(parseIdCsv("7", "database id")).toEqual([7]);
  });

  it("throws ConfigError when the list is empty", () => {
    expect(() => parseIdCsv("", "database id")).toThrow(
      new ConfigError("expected at least one database id (comma separated)"),
    );
  });

  it("throws ConfigError when the list is only separators", () => {
    expect(() => parseIdCsv(",,", "database id")).toThrow(
      new ConfigError("expected at least one database id (comma separated)"),
    );
  });

  it("throws ConfigError on a non-integer entry, preserving the raw value", () => {
    expect(() => parseIdCsv("1,abc", "database id")).toThrow(
      new ConfigError(`invalid database id: "abc" (expected integer)`),
    );
  });

  it("throws ConfigError on a zero id (ids start at 1)", () => {
    expect(() => parseIdCsv("0", "database id")).toThrow(
      new ConfigError("invalid database id: 0 (must be ≥ 1)"),
    );
  });
});

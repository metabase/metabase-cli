import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits, trims, and drops empty parts", () => {
    expect(parseCsv("analytics, github , reporting")).toEqual(["analytics", "github", "reporting"]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(parseCsv("   ,   ,  ")).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("preserves a single non-empty token", () => {
    expect(parseCsv("only")).toEqual(["only"]);
  });
});

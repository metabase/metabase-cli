import { describe, expect, it } from "vitest";

import { tryParseTag } from "./tag";

describe("tryParseTag", () => {
  it("parses an OSS-build tag", () => {
    expect(tryParseTag("v0.58.7")).toEqual({ tag: "v0.58.7", build: "oss", major: 58, patch: 7 });
  });

  it("parses an EE-build tag", () => {
    expect(tryParseTag("v1.58.7")).toEqual({ tag: "v1.58.7", build: "ee", major: 58, patch: 7 });
  });

  it("parses a multi-digit major", () => {
    expect(tryParseTag("v0.105.0")).toEqual({
      tag: "v0.105.0",
      build: "oss",
      major: 105,
      patch: 0,
    });
  });

  it("accepts a tag without the leading v", () => {
    expect(tryParseTag("1.59.12")).toEqual({ tag: "1.59.12", build: "ee", major: 59, patch: 12 });
  });

  it.each([
    ["edition prefix outside 0|1", "v2.58.7"],
    ["wholly malformed", "vLOCAL_DEV"],
    ["a head/nightly build tag", "vUNKNOWN"],
  ])("returns null on %s", (_label, input) => {
    expect(tryParseTag(input)).toBeNull();
  });
});

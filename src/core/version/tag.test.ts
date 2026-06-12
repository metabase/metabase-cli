import { describe, expect, it } from "vitest";

import { tryParseTag } from "./tag";

describe("tryParseTag", () => {
  it("parses a v0.* (OSS-prefixed) tag", () => {
    expect(tryParseTag("v0.58.7")).toEqual({ tag: "v0.58.7", major: 58, patch: 7 });
  });

  it("parses a v1.* (EE-prefixed) tag", () => {
    expect(tryParseTag("v1.58.7")).toEqual({ tag: "v1.58.7", major: 58, patch: 7 });
  });

  it("parses a multi-digit major", () => {
    expect(tryParseTag("v0.105.0")).toEqual({
      tag: "v0.105.0",
      major: 105,
      patch: 0,
    });
  });

  it("accepts a tag without the leading v", () => {
    expect(tryParseTag("1.59.12")).toEqual({ tag: "1.59.12", major: 59, patch: 12 });
  });

  it.each([
    ["major prefix outside 0|1", "v2.58.7"],
    ["wholly malformed", "vLOCAL_DEV"],
    ["a head/nightly build tag", "vUNKNOWN"],
  ])("returns null on %s", (_label, input) => {
    expect(tryParseTag(input)).toBeNull();
  });
});

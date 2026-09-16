import { describe, expect, it } from "vitest";

import { editionFromTag, tryParseTag } from "./tag";

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
    ["a locally built jar tag that would read as v1", "v0.1.0-SNAPSHOT"],
    ["a snapshot build of a released line", "v0.59.12-SNAPSHOT"],
  ])("returns null on %s", (_label, input) => {
    expect(tryParseTag(input)).toBeNull();
  });
});

describe("editionFromTag", () => {
  it.each([
    ["a released OSS tag", "v0.61.2", "oss"],
    ["a released EE tag", "v1.61.2", "ee"],
    ["a locally built OSS jar", "v0.62.0-SNAPSHOT", "oss"],
    ["a locally built EE jar", "v1.62.0-SNAPSHOT", "ee"],
  ])("reads the edition off %s", (_label, input, expected) => {
    expect(editionFromTag(input)).toBe(expected);
  });

  it.each([
    ["a head/nightly build tag", "vUNKNOWN"],
    ["a dev checkout tag", "vLOCAL_DEV"],
    ["a semver major outside 0|1", "v2.58.7"],
  ])("returns null on %s", (_label, input) => {
    expect(editionFromTag(input)).toBeNull();
  });
});

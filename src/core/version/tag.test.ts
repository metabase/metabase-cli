import { describe, expect, it } from "vitest";

import { parseTag, VersionTagParseError } from "./tag";

describe("parseTag", () => {
  it("parses an OSS-build tag", () => {
    expect(parseTag("v0.58.7")).toEqual({
      tag: "v0.58.7",
      build: "oss",
      major: 58,
      patch: 7,
    });
  });

  it("parses an EE-build tag", () => {
    expect(parseTag("v1.58.7")).toEqual({
      tag: "v1.58.7",
      build: "ee",
      major: 58,
      patch: 7,
    });
  });

  it("parses a multi-digit major", () => {
    expect(parseTag("v0.105.0")).toEqual({
      tag: "v0.105.0",
      build: "oss",
      major: 105,
      patch: 0,
    });
  });

  it("accepts a tag without the leading v", () => {
    expect(parseTag("1.59.12")).toEqual({
      tag: "1.59.12",
      build: "ee",
      major: 59,
      patch: 12,
    });
  });

  it.each([
    ["edition prefix outside 0|1", "v2.58.7"],
    ["wholly malformed", "vLOCAL_DEV"],
  ])("throws VersionTagParseError on %s", (_label, input) => {
    let caught: unknown;
    try {
      parseTag(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VersionTagParseError);
    if (caught instanceof VersionTagParseError) {
      expect(caught.message).toBe(
        `Unrecognized Metabase version tag: ${JSON.stringify(input)} (expected v0.X.Y or v1.X.Y)`,
      );
      expect(caught.developerDetail).toEqual({ tag: input });
    }
  });
});

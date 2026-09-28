import { describe, expect, it } from "vitest";

import { editionFromTag, parseTag } from "./tag";

describe("parseTag", () => {
  it("parses a v0.* (OSS-prefixed) tag", () => {
    expect(parseTag("v0.58.7")).toEqual({ kind: "release", tag: "v0.58.7", major: 58, patch: 7 });
  });

  it("parses a v1.* (EE-prefixed) tag", () => {
    expect(parseTag("v1.58.7")).toEqual({ kind: "release", tag: "v1.58.7", major: 58, patch: 7 });
  });

  it("parses a multi-digit major", () => {
    expect(parseTag("v0.105.0")).toEqual({
      kind: "release",
      tag: "v0.105.0",
      major: 105,
      patch: 0,
    });
  });

  it("accepts a tag without the leading v", () => {
    expect(parseTag("1.59.12")).toEqual({ kind: "release", tag: "1.59.12", major: 59, patch: 12 });
  });

  it("parses a hotfix tag, whose fourth number semver would refuse", () => {
    expect(parseTag("v0.62.19.5")).toEqual({
      kind: "release",
      tag: "v0.62.19.5",
      major: 62,
      patch: 19,
    });
  });

  it("parses a release-candidate tag", () => {
    expect(parseTag("v1.64.0-RC1")).toEqual({
      kind: "release",
      tag: "v1.64.0-RC1",
      major: 64,
      patch: 0,
    });
  });

  it.each([
    ["major prefix outside 0|1", "v2.58.7"],
    ["wholly malformed", "vLOCAL_DEV"],
    ["a head/nightly build tag", "vUNKNOWN"],
    ["a locally built jar tag that would read as v1", "v0.1.0-SNAPSHOT"],
    ["a snapshot build of a released line", "v0.59.12-SNAPSHOT"],
    ["a fifth number", "v0.62.19.5.1"],
  ])("reads %s as a development build", (_label, input) => {
    expect(parseTag(input)).toEqual({ kind: "development", tag: input });
  });
});

describe("editionFromTag", () => {
  it.each([
    ["a released OSS tag", "v0.61.2", "oss"],
    ["a released EE tag", "v1.61.2", "ee"],
    ["a locally built OSS jar", "v0.62.0-SNAPSHOT", "oss"],
    ["a locally built EE jar", "v1.62.0-SNAPSHOT", "ee"],
    ["an EE hotfix", "v1.63.16.4", "ee"],
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

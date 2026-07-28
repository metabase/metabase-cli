import { describe, expect, it } from "vitest";

import { compareSemver, SemverString } from "./semver";

describe("compareSemver", () => {
  it("returns -1 / 0 / 1 for ordered inputs", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("2.0.0", "1.0.0")).toBe(1);
  });

  it("treats prerelease as lower than the equivalent release", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
  });
});

describe("SemverString", () => {
  it("accepts a valid semver string", () => {
    expect(SemverString.parse("0.1.2")).toBe("0.1.2");
  });

  it("rejects a non-semver value with the canonical message", () => {
    const result = SemverString.safeParse("not-a-version");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "expected semver MAJOR.MINOR.PATCH[-prerelease][+build]",
      );
    }
  });
});

import { describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";

import { parseInteger, parseOptionalInteger } from "./parse-integer";

describe("parseInteger", () => {
  it("returns the parsed value when in range", () => {
    expect(parseInteger("3000", { name: "--port", min: 1 })).toBe(3000);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseInteger("  42 ", { name: "--port", min: 1 })).toBe(42);
  });

  it("accepts the minimum boundary inclusively", () => {
    expect(parseInteger("0", { name: "--max-bytes", min: 0 })).toBe(0);
  });

  it("throws ConfigError below the minimum, naming the flag and bound", () => {
    expect(() => parseInteger("0", { name: "--port", min: 1 })).toThrow(
      new ConfigError("invalid --port: 0 (must be ≥ 1)"),
    );
  });

  it("throws ConfigError on a non-integer literal, preserving the raw string", () => {
    expect(() => parseInteger("1.5", { name: "--tail", min: 0 })).toThrow(
      new ConfigError(`invalid --tail: "1.5" (expected integer)`),
    );
  });

  it("throws ConfigError on a non-numeric string", () => {
    expect(() => parseInteger("abc", { name: "--tail", min: 0 })).toThrow(
      new ConfigError(`invalid --tail: "abc" (expected integer)`),
    );
  });
});

describe("parseOptionalInteger", () => {
  it("returns null for undefined", () => {
    expect(parseOptionalInteger(undefined, { name: "--port", min: 1 })).toBeNull();
  });

  it("returns null for an empty string (omitted flag treated like absent)", () => {
    expect(parseOptionalInteger("", { name: "--port", min: 1 })).toBeNull();
  });

  it("delegates to parseInteger for non-empty values", () => {
    expect(parseOptionalInteger("3100", { name: "--port", min: 1 })).toBe(3100);
  });

  it("propagates ConfigError from parseInteger when the value is invalid", () => {
    expect(() => parseOptionalInteger("0", { name: "--port", min: 1 })).toThrow(
      new ConfigError("invalid --port: 0 (must be ≥ 1)"),
    );
  });
});

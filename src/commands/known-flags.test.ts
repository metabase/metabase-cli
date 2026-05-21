import type { ArgsDef } from "citty";
import { describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";

import { assertKnownFlags } from "./known-flags";

const ARGS: ArgsDef = {
  format: { type: "string", default: "auto" },
  json: { type: "boolean" },
  maxBytes: { type: "string", alias: "max-bytes" },
  models: { type: "string", alias: "m" },
  verified: { type: "boolean" },
  filter: { type: "enum", options: ["all", "mine"], default: "all" },
  id: { type: "positional", required: true },
};

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected assertKnownFlags to throw");
}

function expectUnknownFlag(rawArgs: readonly string[], display: string): void {
  const error = thrownBy(() => assertKnownFlags(rawArgs, ARGS));
  expect(error).toBeInstanceOf(ConfigError);
  if (!(error instanceof ConfigError)) {
    throw new Error("expected ConfigError");
  }
  expect(error.message).toBe(`unknown flag: ${display}`);
  expect(error.exitCode).toBe(2);
}

describe("assertKnownFlags", () => {
  it("accepts declared flags across camelCase, kebab-case, alias, and inline-value forms", () => {
    expect(() =>
      assertKnownFlags(
        ["--json", "--max-bytes", "0", "--maxBytes=0", "-m", "card", "--filter=mine", "42"],
        ARGS,
      ),
    ).not.toThrow();
  });

  it("does not flag a positional argument", () => {
    expect(() => assertKnownFlags(["42"], ARGS)).not.toThrow();
  });

  it("does not treat the value of a value-flag as a flag, even when it starts with a dash", () => {
    expect(() => assertKnownFlags(["--models", "-weird-value"], ARGS)).not.toThrow();
  });

  it("rejects an unknown flag and names it", () => {
    expectUnknownFlag(["--totally-bogus", "x"], "--totally-bogus");
  });

  it("rejects a typo of a known flag (silent no-op footgun)", () => {
    expectUnknownFlag(["--jsonn"], "--jsonn");
  });

  it("rejects a flag the command does not declare even though a sibling command does", () => {
    expectUnknownFlag(["--limit", "10"], "--limit");
  });

  it("strips the inline value when naming the unknown flag", () => {
    expectUnknownFlag(["--bogus=1"], "--bogus");
  });

  it("accepts the negated form of a declared boolean flag", () => {
    expect(() => assertKnownFlags(["--no-verified"], ARGS)).not.toThrow();
  });

  it("rejects a negated unknown flag", () => {
    expectUnknownFlag(["--no-bogus"], "--no-bogus");
  });

  it("stops checking after the -- separator", () => {
    expect(() => assertKnownFlags(["--json", "--", "--not-a-flag"], ARGS)).not.toThrow();
  });

  it("allows the builtin --help and --version flags", () => {
    expect(() => assertKnownFlags(["--help"], ARGS)).not.toThrow();
    expect(() => assertKnownFlags(["--version"], ARGS)).not.toThrow();
  });
});

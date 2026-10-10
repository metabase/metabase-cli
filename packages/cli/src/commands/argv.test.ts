import type { ArgsDef } from "citty";
import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { assertArgv, assertRequiredPositionals } from "./argv";

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
  throw new Error("expected assertArgv to throw");
}

function expectUnknownFlag(rawArgs: readonly string[], display: string): void {
  const error = thrownBy(() => assertArgv(rawArgs, ARGS));
  expect(error).toBeInstanceOf(ConfigError);
  assert(error instanceof ConfigError, "expected ConfigError");
  expect(error.message).toBe(`unknown flag: ${display}`);
}

describe("assertArgv", () => {
  it("accepts declared flags across camelCase, kebab-case, alias, and inline-value forms", () => {
    expect(() =>
      assertArgv(["--json", "--max-bytes", "0", "-m", "card", "--filter=mine", "42"], ARGS),
    ).not.toThrow();
    expect(() => assertArgv(["--maxBytes=0"], ARGS)).not.toThrow();
  });

  it("does not flag a positional argument", () => {
    expect(() => assertArgv(["42"], ARGS)).not.toThrow();
  });

  it("does not treat the value of a value-flag as a flag, even when it starts with a dash", () => {
    expect(() => assertArgv(["--models", "-weird-value"], ARGS)).not.toThrow();
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
    expect(() => assertArgv(["--no-verified"], ARGS)).not.toThrow();
  });

  it("rejects a negated unknown flag", () => {
    expectUnknownFlag(["--no-bogus"], "--no-bogus");
  });

  it("stops checking after the -- separator", () => {
    expect(() => assertArgv(["--json", "--", "--not-a-flag"], ARGS)).not.toThrow();
  });

  it("allows the builtin --help and --version flags", () => {
    expect(() => assertArgv(["--help"], ARGS)).not.toThrow();
    expect(() => assertArgv(["--version"], ARGS)).not.toThrow();
  });
});

const TWO_POSITIONALS: ArgsDef = {
  json: { type: "boolean" },
  id: { type: "positional", required: true },
  state: { type: "positional", required: true },
};

describe("assertRequiredPositionals", () => {
  it("accepts argv that gives every required positional", () => {
    expect(() => assertRequiredPositionals(["1", "on", "--json"], TWO_POSITIONALS)).not.toThrow();
  });

  it("names the missing positional and the command's positionals", () => {
    const error = thrownBy(() => assertRequiredPositionals(["1", "--json"], TWO_POSITIONALS));
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("missing argument: <state> (this command takes <id> <state>)");
  });

  it("reports an unknown flag standing where the positional belongs as the unknown flag", () => {
    const error = thrownBy(() => assertRequiredPositionals(["1", "--on"], TWO_POSITIONALS));
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe("unknown flag: --on");
  });
});

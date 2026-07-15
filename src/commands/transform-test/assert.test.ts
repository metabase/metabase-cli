import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";

import { classifyAssertToken, parseAssertFlags, resolveAssertions } from "./assert";

describe("classifyAssertToken", () => {
  it("classifies a .sql path as a file", () => {
    expect(classifyAssertToken("checks/no_negatives.sql")).toEqual({
      kind: "file",
      path: "checks/no_negatives.sql",
    });
  });

  it("classifies a *.sql pattern as a glob", () => {
    expect(classifyAssertToken("checks/*.sql")).toEqual({ kind: "glob", pattern: "checks/*.sql" });
  });

  it("throws ConfigError for a non-.sql value (inline SQL is not supported)", () => {
    const value = "SELECT * FROM test_output WHERE x < 0";
    expect(() => classifyAssertToken(value)).toThrow(ConfigError);
    expect(() => classifyAssertToken(value)).toThrow(
      `--assert expects a .sql file path or glob (inline SQL is not supported); got: "${value}"`,
    );
  });

  it("throws ConfigError for a bare name without a .sql extension", () => {
    expect(() => classifyAssertToken("no_negatives")).toThrow(ConfigError);
  });
});

describe("parseAssertFlags", () => {
  it("returns an empty list for undefined or blank values", () => {
    expect(parseAssertFlags(undefined)).toEqual([]);
    expect(parseAssertFlags([])).toEqual([]);
    expect(parseAssertFlags(["  "])).toEqual([]);
  });

  it("accepts a single string and splits comma-separated tokens", () => {
    expect(parseAssertFlags("a.sql,b.sql")).toEqual([
      { kind: "file", path: "a.sql" },
      { kind: "file", path: "b.sql" },
    ]);
  });

  it("accepts a repeated array of values", () => {
    expect(parseAssertFlags(["a.sql", "b/*.sql"])).toEqual([
      { kind: "file", path: "a.sql" },
      { kind: "glob", pattern: "b/*.sql" },
    ]);
  });

  it("throws ConfigError when a value is not a .sql file or glob", () => {
    expect(() => parseAssertFlags(["SELECT a, b FROM test_output"])).toThrow(ConfigError);
  });
});

describe("resolveAssertions", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mb-assert-"));
    writeFileSync(join(dir, "no_negatives.sql"), "SELECT * FROM test_output WHERE revenue < 0\n");
    writeFileSync(join(dir, "has_rows.sql"), "SELECT * FROM test_output WHERE 1=0");
    writeFileSync(join(dir, "notes.txt"), "ignore me");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a file token, names it by basename without extension, defaults to error severity", async () => {
    const out = await resolveAssertions([{ kind: "file", path: join(dir, "no_negatives.sql") }]);
    expect(out).toEqual([
      {
        name: "no_negatives",
        sql: "SELECT * FROM test_output WHERE revenue < 0",
        severity: "error",
      },
    ]);
  });

  it("expands a glob to one assertion per matching .sql file, sorted by name", async () => {
    const out = await resolveAssertions([{ kind: "glob", pattern: join(dir, "*.sql") }]);
    expect(out.map((a) => a.name)).toEqual(["has_rows", "no_negatives"]);
    expect(out.every((a) => a.severity === "error")).toBe(true);
  });

  it("resolves multiple file tokens preserving order, each named by basename", async () => {
    const out = await resolveAssertions([
      { kind: "file", path: join(dir, "has_rows.sql") },
      { kind: "file", path: join(dir, "no_negatives.sql") },
    ]);
    expect(out.map((a) => a.name)).toEqual(["has_rows", "no_negatives"]);
  });

  it("throws ConfigError for a missing file", async () => {
    await expect(
      resolveAssertions([{ kind: "file", path: join(dir, "nope.sql") }]),
    ).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError for a glob that matches nothing", async () => {
    await expect(
      resolveAssertions([{ kind: "glob", pattern: join(dir, "zzz-*.sql") }]),
    ).rejects.toThrow(ConfigError);
  });
});

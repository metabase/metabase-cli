import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import type { FlagValues } from "./flag-values";
import { type QueryMode, queryModeFlags, resolveQueryMode } from "./query-mode";

type ModeArgs = Partial<FlagValues<typeof queryModeFlags>>;

function resolve(overrides: ModeArgs): QueryMode {
  return resolveQueryMode({
    "dry-run": undefined,
    compile: undefined,
    metadata: undefined,
    pretty: undefined,
    "export-format": undefined,
    "format-rows": false,
    "pivot-results": false,
    "csv-include-bom": false,
    "visualization-settings": undefined,
    "print-schema": undefined,
    ...overrides,
  });
}

function refusal(overrides: ModeArgs): string {
  try {
    resolve(overrides);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("resolveQueryMode", () => {
  it("runs the query when no mode flag is given", () => {
    expect(resolve({})).toEqual({ kind: "run" });
  });

  it("compiles with the server's pretty default and turns it off under --no-pretty", () => {
    expect(resolve({ compile: true })).toEqual({ kind: "compile", pretty: undefined });
    expect(resolve({ compile: true, pretty: false })).toEqual({ kind: "compile", pretty: false });
  });

  it("exports carrying the export-only flags", () => {
    expect(resolve({ "export-format": "csv", "format-rows": true })).toEqual({
      kind: "export",
      format: "csv",
      params: {
        format_rows: true,
        pivot_results: false,
        csv_include_bom: false,
        visualization_settings: undefined,
      },
    });
  });

  it("refuses two mode flags naming the first and the rest", () => {
    expect(refusal({ compile: true, metadata: true })).toBe(
      "--compile cannot be combined with --metadata",
    );
    expect(refusal({ "dry-run": true, compile: true, "export-format": "csv" })).toBe(
      "--dry-run cannot be combined with --compile, --export-format",
    );
  });

  it("refuses --no-pretty outside --compile", () => {
    expect(refusal({ pretty: false })).toBe("--no-pretty requires --compile");
    expect(refusal({ metadata: true, pretty: false })).toBe("--no-pretty requires --compile");
  });

  it("refuses an export-only flag without --export-format", () => {
    expect(refusal({ "pivot-results": true })).toBe("--pivot-results requires --export-format");
  });

  it("refuses an unknown export format naming the choices", () => {
    expect(refusal({ "export-format": "html" })).toBe(
      'invalid --export-format: "html" (expected one of: csv, json, xlsx)',
    );
  });
});

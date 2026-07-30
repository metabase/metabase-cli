import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssertionResult, TestRunResult } from "@metabase/client/domain/transform-test-run";
import { ConfigError } from "@metabase/client/errors";

import { FULL_RANGE } from "../../output/types";
import type { CommonContext } from "../context";

import {
  assertionsSummaryLine,
  parseColumnList,
  parseInputPairs,
  parseTargetType,
  renderRunResult,
  shouldFail,
} from "./subgraph";

function assertion(over: Partial<AssertionResult> & { name: string }): AssertionResult {
  return {
    status: "passed",
    failing_row_count: 0,
    sample_rows: null,
    columns: [],
    ...over,
  };
}

function result(over: Partial<TestRunResult>): TestRunResult {
  return { status: "passed", diff: null, ...over };
}

function renderCtx(over: Partial<CommonContext>): CommonContext {
  return {
    format: "text",
    full: false,
    fields: undefined,
    maxBytes: 65536,
    range: FULL_RANGE,
    url: undefined,
    apiKey: undefined,
    profile: undefined,
    skipPreflight: false,
    ...over,
  };
}

describe("parseInputPairs", () => {
  it("parses comma-separated <id>=<path> pairs", () => {
    expect(parseInputPairs("229=orders.csv,223=people.csv")).toEqual([
      { tableId: 229, path: "orders.csv" },
      { tableId: 223, path: "people.csv" },
    ]);
  });

  it("returns an empty array for undefined or blank input", () => {
    expect(parseInputPairs(undefined)).toEqual([]);
    expect(parseInputPairs("   ")).toEqual([]);
  });

  it("trims whitespace around entries and around each side of '='", () => {
    expect(parseInputPairs(" 1 = a.csv , 2 = b.csv ")).toEqual([
      { tableId: 1, path: "a.csv" },
      { tableId: 2, path: "b.csv" },
    ]);
  });

  it("throws ConfigError with the offending entry when '=' is missing", () => {
    expect(() => parseInputPairs("229")).toThrow(ConfigError);
    expect(() => parseInputPairs("229")).toThrow(
      "Malformed --input entry '229'. Expected <table-id>=<file> (e.g. 229=orders.csv).",
    );
  });

  it("throws ConfigError when the table id is not a positive integer", () => {
    expect(() => parseInputPairs("0=x.csv")).toThrow(ConfigError);
    expect(() => parseInputPairs("0=x.csv")).toThrow("invalid --input table id: 0 (must be ≥ 1)");
  });
});

describe("parseColumnList", () => {
  it("splits and trims comma-separated names", () => {
    expect(parseColumnList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for undefined or blank input", () => {
    expect(parseColumnList(undefined)).toEqual([]);
    expect(parseColumnList("")).toEqual([]);
  });
});

describe("parseTargetType", () => {
  it("accepts the supported target types", () => {
    expect(parseTargetType("transform")).toBe("transform");
    expect(parseTargetType("card")).toBe("card");
  });

  it("throws ConfigError naming the supported types for an unsupported value", () => {
    expect(() => parseTargetType("metric")).toThrow(ConfigError);
    expect(() => parseTargetType("metric")).toThrow(
      'invalid --target-type: "metric" (expected one of: transform, card)',
    );
  });
});

describe("shouldFail", () => {
  it("fails when the top-level status is failed", () => {
    expect(shouldFail(result({ status: "failed" }))).toBe(true);
  });

  it("passes when the top-level status is passed, even with a failing warn assertion", () => {
    const res = result({
      status: "passed",
      assertions: [assertion({ name: "w", status: "warn", failing_row_count: 3 })],
    });
    expect(shouldFail(res)).toBe(false);
  });
});

describe("assertionsSummaryLine", () => {
  it("renders the passed/failed/warn breakdown with the first failing assertion", () => {
    const res = result({
      status: "failed",
      assertions: [
        assertion({ name: "ok", status: "passed" }),
        assertion({ name: "neg_rev", status: "failed", failing_row_count: 3 }),
        assertion({ name: "warned", status: "warn", failing_row_count: 2 }),
      ],
    });
    expect(assertionsSummaryLine(res)).toBe(
      "3 assertions — 1 passed, 1 FAILED, 1 warn (neg_rev: 3 failing rows)",
    );
  });

  it("returns null when there are no assertions", () => {
    expect(assertionsSummaryLine(result({ status: "passed" }))).toBeNull();
    expect(assertionsSummaryLine(result({ status: "passed", assertions: [] }))).toBeNull();
  });
});

describe("renderRunResult", () => {
  let stdout: string;

  beforeEach(() => {
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const failingResult = result({
    status: "failed",
    diff: null,
    assertions: [
      assertion({ name: "ok_check", status: "passed" }),
      assertion({ name: "neg_rev", status: "failed", failing_row_count: 3 }),
    ],
  });

  it("renders the per-assertion table on a FAILING run in human/text mode", () => {
    renderRunResult("transform", 173, failingResult, renderCtx({ format: "text" }));
    // Summary line(s)
    expect(stdout).toContain("Transform 173 test run FAILED");
    expect(stdout).toContain("2 assertions — 1 passed, 1 FAILED");
    // The per-assertion table: header + each assertion's name/status/failing rows
    expect(stdout).toContain("Name");
    expect(stdout).toContain("Status");
    expect(stdout).toContain("Failing Rows");
    expect(stdout).toContain("ok_check");
    expect(stdout).toContain("neg_rev");
    expect(stdout).toContain("failed");
  });

  it("emits the full structured JSON (no human table) under --json", () => {
    renderRunResult("transform", 173, failingResult, renderCtx({ format: "json" }));
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.assertions).toHaveLength(2);
    expect(parsed.assertions[1].name).toBe("neg_rev");
    // No bordered text table in JSON mode.
    expect(stdout).not.toContain("Failing Rows");
  });

  it("renders the per-assertion table on a PASSING run in text mode", () => {
    const passing = result({
      status: "passed",
      assertions: [assertion({ name: "ok_check", status: "passed" })],
    });
    renderRunResult("transform", 173, passing, renderCtx({ format: "text" }));
    expect(stdout).toContain("Transform 173 test run passed.");
    expect(stdout).toContain("ok_check");
    expect(stdout).toContain("Failing Rows");
  });
});

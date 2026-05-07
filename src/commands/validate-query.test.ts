import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "../core/errors";
import { ValidationOutcome } from "../core/schema/validate";
import { parseJson } from "../runtime/json";

import { preflightInternalMbql5Query } from "./validate-query";

interface Streams {
  stdout: string;
  stderr: string;
}

let streams: Streams;

beforeEach(() => {
  streams = { stdout: "", stderr: "" };
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    streams.stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    streams.stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preflightInternalMbql5Query", () => {
  it("returns silently when the body is not MBQL 5 (legacy MBQL 4)", () => {
    preflightInternalMbql5Query(
      { type: "query", database: 1, query: { "source-table": 5 } },
      "card.dataset_query validation failed",
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("returns silently when the body is undefined / null / non-object", () => {
    preflightInternalMbql5Query(undefined, "x");
    preflightInternalMbql5Query(null, "x");
    preflightInternalMbql5Query("native sql", "x");
    expect(streams.stdout).toBe("");
  });

  it("returns silently when the MBQL 5 body validates", () => {
    preflightInternalMbql5Query(
      {
        "lib/type": "mbql/query",
        database: 1,
        stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
      },
      "card.dataset_query validation failed",
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("writes the structured envelope and throws ConfigError when MBQL 5 validation fails", () => {
    expect(() =>
      preflightInternalMbql5Query(
        {
          "lib/type": "mbql/query",
          database: "oops",
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
        },
        "card.dataset_query validation failed",
      ),
    ).toThrow(
      new ConfigError(
        "card.dataset_query validation failed: 1 error(s) — pass valid MBQL 5 or use the legacy format",
      ),
    );
    expect(parseJson(streams.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
  });
});

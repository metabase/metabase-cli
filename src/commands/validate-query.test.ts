import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "../core/errors";
import { ValidationOutcome } from "../core/schema/validate";
import { parseJson } from "../runtime/json";

import {
  CARD_DATASET_QUERY_LABELS,
  TRANSFORM_SOURCE_QUERY_LABELS,
  preflightInternalMbql5Query,
} from "./validate-query";

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
      CARD_DATASET_QUERY_LABELS,
      { skip: false },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("returns silently when the body is undefined / null / non-object", () => {
    preflightInternalMbql5Query(undefined, CARD_DATASET_QUERY_LABELS, { skip: false });
    preflightInternalMbql5Query(null, CARD_DATASET_QUERY_LABELS, { skip: false });
    preflightInternalMbql5Query("native sql", CARD_DATASET_QUERY_LABELS, { skip: false });
    expect(streams.stdout).toBe("");
  });

  it("returns silently when the MBQL 5 body validates", () => {
    preflightInternalMbql5Query(
      {
        "lib/type": "mbql/query",
        database: 1,
        stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
      },
      CARD_DATASET_QUERY_LABELS,
      { skip: false },
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
        CARD_DATASET_QUERY_LABELS,
        { skip: false },
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

  it("returns silently when skip is true, regardless of body validity", () => {
    preflightInternalMbql5Query(
      {
        "lib/type": "mbql/query",
        database: "oops",
        stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
      },
      CARD_DATASET_QUERY_LABELS,
      { skip: true },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("rejects MBQL 5 nested inside a legacy MBQL 4 envelope with a targeted message", () => {
    const doubleWrapped = {
      type: "query",
      database: 2,
      query: {
        "lib/type": "mbql/query",
        database: 2,
        stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
      },
    };
    expect(() =>
      preflightInternalMbql5Query(doubleWrapped, CARD_DATASET_QUERY_LABELS, { skip: false }),
    ).toThrow(
      new ConfigError(
        'card.dataset_query validation failed: MBQL 5 query nested inside a legacy {type:"query", query:…} envelope. ' +
          "For MBQL 5, dataset_query is the mbql/query value itself: " +
          '{"lib/type":"mbql/query", database:N, stages:[…]}.',
      ),
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("names source.query when the transform preset is threaded", () => {
    const doubleWrapped = {
      type: "query",
      database: 2,
      query: {
        "lib/type": "mbql/query",
        database: 2,
        stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
      },
    };
    expect(() =>
      preflightInternalMbql5Query(doubleWrapped, TRANSFORM_SOURCE_QUERY_LABELS, { skip: false }),
    ).toThrow(
      new ConfigError(
        'transform.source.query validation failed: MBQL 5 query nested inside a legacy {type:"query", query:…} envelope. ' +
          "For MBQL 5, source.query is the mbql/query value itself: " +
          '{"lib/type":"mbql/query", database:N, stages:[…]}.',
      ),
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("legacy-envelope detection is bypassed by skip", () => {
    preflightInternalMbql5Query(
      {
        type: "query",
        database: 2,
        query: { "lib/type": "mbql/query", database: 2, stages: [] },
      },
      CARD_DATASET_QUERY_LABELS,
      { skip: true },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { ValidationOutcome } from "../core/schema/validate";
import {
  CARD_DATASET_QUERY,
  TRANSFORM_SOURCE_QUERY,
  preflightEmbeddedQuery,
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

describe("preflightEmbeddedQuery", () => {
  it("returns silently when the body is not MBQL 5 (legacy MBQL 4)", () => {
    preflightEmbeddedQuery(
      { dataset_query: { type: "query", database: 1, query: { "source-table": 5 } } },
      CARD_DATASET_QUERY,
      { skip: false },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("returns silently when the query is absent, null, or not an object", () => {
    preflightEmbeddedQuery({}, CARD_DATASET_QUERY, { skip: false });
    preflightEmbeddedQuery({ dataset_query: null }, CARD_DATASET_QUERY, { skip: false });
    preflightEmbeddedQuery({ dataset_query: "native sql" }, CARD_DATASET_QUERY, { skip: false });
    preflightEmbeddedQuery({ source: { type: "python" } }, TRANSFORM_SOURCE_QUERY, { skip: false });
    expect(streams.stdout).toBe("");
  });

  it("returns silently when the MBQL 5 body validates", () => {
    preflightEmbeddedQuery(
      {
        dataset_query: {
          "lib/type": "mbql/query",
          database: 1,
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
        },
      },
      CARD_DATASET_QUERY,
      { skip: false },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("writes the structured envelope and throws ConfigError when MBQL 5 validation fails", () => {
    expect(() =>
      preflightEmbeddedQuery(
        {
          dataset_query: {
            "lib/type": "mbql/query",
            database: "oops",
            stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
          },
        },
        CARD_DATASET_QUERY,
        { skip: false },
      ),
    ).toThrow(
      new ConfigError(
        "card.dataset_query validation failed: 1 error(s) — fix them, or pass --skip-validate to send anyway",
      ),
    );
    expect(parseJson(streams.stdout, ValidationOutcome)).toEqual({
      ok: false,
      errors: [{ path: "/database", message: "must be integer" }],
    });
  });

  it("leaves a stray query beside a python transform source unchecked", () => {
    preflightEmbeddedQuery(
      {
        source: {
          type: "python",
          body: "",
          query: { "lib/type": "mbql/query", database: "oops", stages: [] },
        },
      },
      TRANSFORM_SOURCE_QUERY,
      { skip: false },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("returns silently when skip is true, regardless of body validity", () => {
    preflightEmbeddedQuery(
      {
        dataset_query: {
          "lib/type": "mbql/query",
          database: "oops",
          stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 7 }],
        },
      },
      CARD_DATASET_QUERY,
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
      preflightEmbeddedQuery({ dataset_query: doubleWrapped }, CARD_DATASET_QUERY, { skip: false }),
    ).toThrow(
      new ConfigError(
        `card.dataset_query validation failed: dataset_query is the query itself: ` +
          '{"lib/type": "mbql/query", "database": N, "stages": […]}.',
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
      preflightEmbeddedQuery(
        { source: { type: "query", query: doubleWrapped } },
        TRANSFORM_SOURCE_QUERY,
        { skip: false },
      ),
    ).toThrow(
      new ConfigError(
        `transform.source.query validation failed: source.query is the query itself: ` +
          '{"lib/type": "mbql/query", "database": N, "stages": […]}.',
      ),
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });

  it("legacy-envelope detection is bypassed by skip", () => {
    preflightEmbeddedQuery(
      {
        dataset_query: {
          type: "query",
          database: 2,
          query: { "lib/type": "mbql/query", database: 2, stages: [] },
        },
      },
      CARD_DATASET_QUERY,
      { skip: true },
    );
    expect(streams.stdout).toBe("");
    expect(streams.stderr).toBe("");
  });
});

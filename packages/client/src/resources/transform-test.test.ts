import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const TRANSFORM_TEST = {
  id: 3,
  entity_id: "AbCdEfGhIjKlMnOpQrStU",
  transform_id: 7,
  creator_id: 1,
  name: "people summary holds one row",
  description: null,
  inputs: [
    {
      table: { schema: "public", name: "people" },
      format: "rows",
      columns: [{ name: "id", cast_type: "INTEGER" }],
      rows: [{ id: 1 }],
    },
  ],
  expectations: [{ type: "empty", name: "no null ids", sql: "SELECT * FROM out WHERE id IS NULL" }],
  created_at: "2026-09-15T12:00:00Z",
  updated_at: "2026-09-15T12:00:00Z",
};

const RUN_RESULT = {
  status: "failed",
  expectations: [
    {
      name: "no null ids",
      type: "empty",
      status: "failed",
      columns: [{ name: "id", database_type: "INTEGER" }],
      sample: [{ id: null }],
      truncated: 0,
    },
  ],
  tables: { mb_test_a1b2: "public.people" },
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

function clientOver(responses: FetchScript) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("transform-test resource wire requests", () => {
  it("sends the list request with no query string when no transform is named", async () => {
    const { mb, capture } = clientOver([jsonResponse([TRANSFORM_TEST])]);

    await mb.transformTest.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the list request narrowed to one transform", async () => {
    const { mb, capture } = clientOver([jsonResponse([TRANSFORM_TEST])]);

    await mb.transformTest.list({ "transform-id": 7 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test?transform-id=7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TRANSFORM_TEST])]);

    expect(await mb.transformTest.list()).toEqual({ data: [TRANSFORM_TEST], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TRANSFORM_TEST)]);

    await mb.transformTest.get(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test/3",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(TRANSFORM_TEST)]);

    await mb.transformTest.create({
      transform_id: 7,
      name: TRANSFORM_TEST.name,
      inputs: [
        {
          table: { schema: "public", name: "people" },
          format: "sql",
          sql: "SELECT 1 AS id",
        },
      ],
      expectations: [{ type: "empty", name: "no null ids", sql: "SELECT * FROM out" }],
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"transform_id":7,"name":"people summary holds one row","inputs":[{"table":{"schema":"public","name":"people"},"format":"sql","sql":"SELECT 1 AS id"}],"expectations":[{"type":"empty","name":"no null ids","sql":"SELECT * FROM out"}]}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the fields it patches", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TRANSFORM_TEST, name: "renamed" })]);

    await mb.transformTest.update(3, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test/3",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transformTest.delete(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test/3",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run request as a bodiless POST", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN_RESULT)]);

    await mb.transformTest.run(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-test/3/run",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("returns what each expectation found, keeping the wire's kebab-case report keys", async () => {
    const { mb } = clientOver([
      jsonResponse({
        ...RUN_RESULT,
        expectations: [
          {
            name: "output",
            type: "equals",
            status: "failed",
            "row-counts": { actual: 2, expected: 1 },
            "extra-rows": [{ id: 1 }],
            "missing-rows": [],
            "cell-mismatches": [{ column: "id", expected: 1, actual: 2 }],
            truncated: 0,
          },
        ],
      }),
    ]);

    expect(await mb.transformTest.run(3)).toEqual({
      status: "failed",
      expectations: [
        {
          name: "output",
          type: "equals",
          status: "failed",
          "row-counts": { actual: 2, expected: 1 },
          "extra-rows": [{ id: 1 }],
          "missing-rows": [],
          "cell-mismatches": [{ column: "id", expected: 1, actual: 2 }],
          truncated: 0,
        },
      ],
      tables: { mb_test_a1b2: "public.people" },
    });
  });
});

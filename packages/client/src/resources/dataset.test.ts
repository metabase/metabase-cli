import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { NetworkError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const STREAM_REQUEST_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const MBQL_QUERY = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 2 }],
};

const MBQL_QUERY_JSON =
  '{"lib/type":"mbql/query","database":1,"stages":[{"lib/type":"mbql.stage/mbql","source-table":2}]}';

const COMPILED = { query: "SELECT 1", params: null };

const EMPTY_METADATA = { databases: [], tables: [], fields: [], snippets: [] };

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("dataset resource wire requests", () => {
  it("posts the ad-hoc query body verbatim", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "completed" })]);

    await mb.dataset.query(MBQL_QUERY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dataset",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: MBQL_QUERY_JSON,
      },
    ]);
  });

  it("posts the query verbatim to native when pretty is left to the server", async () => {
    const { mb, capture } = clientOver([jsonResponse(COMPILED)]);

    await mb.dataset.native(MBQL_QUERY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dataset/native",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: MBQL_QUERY_JSON,
      },
    ]);
  });

  it("carries pretty inside the native request body beside the query", async () => {
    const { mb, capture } = clientOver([jsonResponse(COMPILED)]);

    await mb.dataset.native(MBQL_QUERY, { pretty: false });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dataset/native",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"lib/type":"mbql/query","database":1,"stages":[{"lib/type":"mbql.stage/mbql","source-table":2}],"pretty":false}',
      },
    ]);
  });

  it("posts the query as the query_metadata request body", async () => {
    const { mb, capture } = clientOver([jsonResponse(EMPTY_METADATA)]);

    await mb.dataset.queryMetadata(MBQL_QUERY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dataset/query_metadata",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: MBQL_QUERY_JSON,
      },
    ]);
  });

  it("sends the export request as JSON under the format path and accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response("id,total\n1,9\n")]);

    await mb.dataset.exportQuery("csv", {
      query: MBQL_QUERY,
      format_rows: true,
      pivot_results: false,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dataset/csv",
        method: "POST",
        headers: STREAM_REQUEST_HEADERS,
        body: `{"query":${MBQL_QUERY_JSON},"format_rows":true,"pivot_results":false}`,
      },
    ]);
  });

  it("hands back the download bytes unparsed, so a caller can pipe them", async () => {
    const { mb } = clientOver([new Response("id,total\n1,9\n")]);

    const stream = await mb.dataset.exportQuery("csv", {
      query: MBQL_QUERY,
      format_rows: true,
      pivot_results: false,
    });

    expect(await new Response(stream).text()).toBe("id,total\n1,9\n");
  });

  it("refuses an export whose response carries no body at all", async () => {
    const { mb } = clientOver([new Response(null, { status: 204 })]);

    const error = await mb.dataset
      .exportQuery("csv", { query: MBQL_QUERY, format_rows: true, pivot_results: false })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.message).toBe("Response had no body to stream");
    expect(error.developerDetail).toEqual({
      method: "POST",
      url: "https://mb.example.com/metabase/api/dataset/csv",
      cause: "missing body",
    });
  });
});

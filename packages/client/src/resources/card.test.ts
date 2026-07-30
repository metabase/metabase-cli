import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { NetworkError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const CARD = {
  id: 7,
  name: "Orders",
  type: "question",
  display: "table",
  description: null,
  archived: false,
  query_type: "query",
  database_id: 1,
  table_id: 2,
  collection_id: 3,
  entity_id: "aaaaaaaaaaaaaaaaaaaaa",
  creator_id: 1,
  dataset_query: { type: "query" },
  visualization_settings: {},
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

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("card resource wire requests", () => {
  it("sends the list request with both filter parameters", async () => {
    const { mb, capture } = clientOver([jsonResponse([CARD])]);

    await mb.card.list({ f: "using_model", model_id: "42" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card?f=using_model&model_id=42",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits an unset list parameter from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([CARD])]);

    await mb.card.list({ f: "all" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card?f=all",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("wraps the bare list array in a ListResult that claims no server count", async () => {
    const { mb } = clientOver([jsonResponse([CARD])]);

    expect(await mb.card.list()).toEqual({ data: [CARD], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(CARD)]);

    await mb.card.get(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card/7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(CARD)]);

    await mb.card.create({
      name: "Orders",
      display: "table",
      dataset_query: { type: "query" },
      visualization_settings: {},
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Orders","display":"table","dataset_query":{"type":"query"},"visualization_settings":{}}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(CARD)]);

    await mb.card.update(7, { name: "Renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...CARD, archived: true })]);

    await mb.card.archive(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });

  it("sends the query request with the parameters array", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "completed" })]);

    await mb.card.query(7, { parameters: [{ type: "category", value: "A" }] });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card/7/query",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"parameters":[{"type":"category","value":"A"}]}',
      },
    ]);
  });

  it("sends the export request form-encoded and accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response("id,total\n1,9\n")]);

    await mb.card.exportQuery(7, "csv", {
      parameters: [],
      format_rows: true,
      pivot_results: false,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/card/7/query/csv",
        method: "POST",
        headers: {
          accept: "*/*",
          "user-agent": TEST_USER_AGENT,
          "x-api-key": "mb_wire_test_key",
        },
        body: "parameters=%5B%5D&format_rows=true&pivot_results=false",
      },
    ]);
  });

  it("hands back the download bytes unparsed, so a caller can pipe them", async () => {
    const { mb } = clientOver([new Response("id,total\n1,9\n")]);

    const stream = await mb.card.exportQuery(7, "csv", {
      parameters: [],
      format_rows: true,
      pivot_results: false,
    });

    expect(await new Response(stream).text()).toBe("id,total\n1,9\n");
  });

  it("refuses an export whose response carries no body at all", async () => {
    const { mb } = clientOver([new Response(null, { status: 204 })]);

    const error = await mb.card
      .exportQuery(7, "csv", { parameters: [], format_rows: true, pivot_results: false })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.message).toBe("Response had no body to stream");
    expect(error.developerDetail).toEqual({
      method: "POST",
      url: "https://mb.example.com/metabase/api/card/7/query/csv",
      cause: "missing body",
    });
  });
});

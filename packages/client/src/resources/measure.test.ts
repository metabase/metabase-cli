import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const MEASURE = {
  id: 4,
  name: "Total revenue",
  description: null,
  archived: false,
  table_id: 11,
  definition: { aggregation: [["sum", ["field", 3, null]]] },
  creator_id: 1,
  entity_id: "bbbbbbbbbbbbbbbbbbbbb",
  created_at: "2026-01-02T03:04:05Z",
  updated_at: "2026-01-02T03:04:05Z",
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

describe("measure resource wire requests", () => {
  it("sends the list request with no query parameters", async () => {
    const { mb, capture } = clientOver([jsonResponse([MEASURE])]);

    await mb.measure.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/measure",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no server count for the bare-array list", async () => {
    const { mb } = clientOver([jsonResponse([MEASURE])]);

    await expect(mb.measure.list()).resolves.toEqual({ data: [MEASURE], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(MEASURE)]);

    await mb.measure.get(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/measure/4",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(MEASURE)]);

    await mb.measure.create({
      name: "Total revenue",
      table_id: 11,
      definition: { aggregation: [["sum", ["field", 3, null]]] },
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/measure",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Total revenue","table_id":11,"definition":{"aggregation":[["sum",["field",3,null]]]}}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(MEASURE)]);

    await mb.measure.update(4, { name: "Renamed", revision_message: "rename" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/measure/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed","revision_message":"rename"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived and the revision message", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...MEASURE, archived: true })]);

    await mb.measure.archive(4, { revision_message: "deprecated" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/measure/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true,"revision_message":"deprecated"}',
      },
    ]);
  });
});

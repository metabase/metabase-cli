import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SEGMENT = {
  id: 4,
  name: "Returning customers",
  description: null,
  archived: false,
  table_id: 2,
  definition: { filter: ["=", ["field", 11, null], true] },
  creator_id: 1,
  entity_id: "bbbbbbbbbbbbbbbbbbbbb",
  show_in_getting_started: false,
  caveats: null,
  points_of_interest: null,
  created_at: "2026-01-02T03:04:05.678Z",
  updated_at: "2026-01-02T03:04:05.678Z",
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

describe("segment resource wire requests", () => {
  it("sends the list request without a query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([SEGMENT])]);

    await mb.segment.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/segment",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("wraps the bare list array in a ListResult that claims no server count", async () => {
    const { mb } = clientOver([jsonResponse([SEGMENT])]);

    expect(await mb.segment.list()).toEqual({ data: [SEGMENT], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(SEGMENT)]);

    await mb.segment.get(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/segment/4",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(SEGMENT)]);

    await mb.segment.create({
      name: "Returning customers",
      table_id: 2,
      definition: { filter: ["=", ["field", 11, null], true] },
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/segment",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Returning customers","table_id":2,"definition":{"filter":["=",["field",11,null],true]}}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(SEGMENT)]);

    await mb.segment.update(4, { name: "Renamed", revision_message: "rename" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/segment/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed","revision_message":"rename"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived and the revision message", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...SEGMENT, archived: true })]);

    await mb.segment.archive(4, { revision_message: "deprecated" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/segment/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true,"revision_message":"deprecated"}',
      },
    ]);
  });
});

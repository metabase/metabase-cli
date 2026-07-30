import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const DOCUMENT = {
  id: 4,
  name: "Runbook",
  document: { type: "doc" },
  entity_id: "bbbbbbbbbbbbbbbbbbbbb",
  collection_id: 3,
  creator_id: 1,
  archived: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const DOCUMENT_BODY = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { _id: "6f1a" } }],
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

describe("document resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ items: [DOCUMENT] })]);

    await mb.document.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("unwraps the { items } list envelope into a ListResult with no server count", async () => {
    const { mb } = clientOver([jsonResponse({ items: [DOCUMENT] })]);

    expect(await mb.document.list()).toEqual({ data: [DOCUMENT], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(DOCUMENT)]);

    await mb.document.get(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(DOCUMENT)]);

    await mb.document.create({ name: "Runbook", document: DOCUMENT_BODY, collection_id: 3 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Runbook","document":{"type":"doc","content":[{"type":"paragraph","attrs":{"_id":"6f1a"}}]},"collection_id":3}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DOCUMENT, name: "Renamed" })]);

    await mb.document.update(4, { name: "Renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DOCUMENT, archived: true })]);

    await mb.document.archive(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/document/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });
});

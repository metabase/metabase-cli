import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SNIPPET = {
  id: 4,
  name: "active",
  description: null,
  content: "WHERE active = true",
  archived: false,
  collection_id: null,
  creator_id: 1,
  entity_id: "aaaaaaaaaaaaaaaaaaaaa",
  template_tags: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
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

describe("snippet resource wire requests", () => {
  it("sends the list request with the archived filter", async () => {
    const { mb, capture } = clientOver([jsonResponse([{ ...SNIPPET, archived: true }])]);

    await mb.snippet.list({ archived: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/native-query-snippet?archived=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits an unset archived filter from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([SNIPPET])]);

    await mb.snippet.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/native-query-snippet",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("wraps the bare list array in a ListResult that claims no server count", async () => {
    const { mb } = clientOver([jsonResponse([SNIPPET])]);

    expect(await mb.snippet.list()).toEqual({ data: [SNIPPET], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(SNIPPET)]);

    await mb.snippet.get(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/native-query-snippet/4",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(SNIPPET)]);

    await mb.snippet.create({ name: "active", content: "WHERE active = true" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/native-query-snippet",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"active","content":"WHERE active = true"}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...SNIPPET, name: "renamed" })]);

    await mb.snippet.update(4, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/native-query-snippet/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...SNIPPET, archived: true })]);

    await mb.snippet.archive(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/native-query-snippet/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });
});

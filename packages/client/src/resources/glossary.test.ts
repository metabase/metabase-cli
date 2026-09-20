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

const ENTRY = {
  id: 7,
  term: "Churn",
  definition: "Customers lost in a period over customers at its start.",
  creator_id: 1,
  creator: { id: 1, email: "ada@example.com", first_name: "Ada", last_name: null },
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

describe("glossary resource wire requests", () => {
  it("sends the list request without a query string", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [ENTRY] })]);

    await mb.glossary.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/glossary",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the search term as the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [ENTRY] })]);

    await mb.glossary.list({ search: "chu rn" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/glossary?search=chu+rn",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("unwraps the data envelope and reports no total, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse({ data: [ENTRY], can_write: true })]);

    expect(await mb.glossary.list()).toEqual({ data: [ENTRY], total: null });
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(ENTRY)]);

    await mb.glossary.create({ term: ENTRY.term, definition: ENTRY.definition });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/glossary",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ term: ENTRY.term, definition: ENTRY.definition }),
      },
    ]);
  });

  it("sends the update request as a PUT carrying the whole entry body", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...ENTRY, definition: "Lost customers." })]);

    await mb.glossary.update(7, { term: ENTRY.term, definition: "Lost customers." });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/glossary/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ term: ENTRY.term, definition: "Lost customers." }),
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.glossary.delete(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/glossary/7",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

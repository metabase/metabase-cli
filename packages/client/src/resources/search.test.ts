import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SEARCH_RESULT = {
  id: 7,
  name: "Orders",
  model: "card",
  description: null,
  archived: false,
  collection: { id: 3, name: "Reports", authority_level: null, type: null },
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

describe("search resource wire requests", () => {
  it("sends every search parameter, repeating the models key once per model", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [SEARCH_RESULT], total: 1 })]);

    await mb.search.query({
      q: "orders",
      models: ["card", "dashboard"],
      archived: true,
      limit: 20,
      offset: 40,
      table_db_id: 2,
      verified: true,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/search?q=orders&models=card&models=dashboard&archived=true&limit=20&offset=40&table_db_id=2&verified=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits every unset search parameter from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [], total: 0 })]);

    await mb.search.query({ q: "orders" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/search?q=orders",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("returns the server's slice alongside its count across the whole result set", async () => {
    const { mb } = clientOver([jsonResponse({ data: [SEARCH_RESULT], total: 137 })]);

    const page = await mb.search.query({ q: "orders", limit: 1 });

    expect(page).toEqual({ data: [SEARCH_RESULT], total: 137 });
  });
});

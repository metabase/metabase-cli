import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const DATABASE = {
  id: 1,
  name: "Warehouse",
  engine: "postgres",
  is_saved_questions: false,
  initial_sync_status: "complete",
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

describe("database resource wire requests", () => {
  it("sends the list request with both query parameters", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [DATABASE], total: 1 })]);

    await mb.database.list({ include: "tables", saved: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database?include=tables&saved=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits unset list parameters from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [DATABASE], total: 1 })]);

    await mb.database.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("surfaces the server's own count as the list total", async () => {
    const { mb } = clientOver([jsonResponse({ data: [DATABASE], total: 37 })]);

    expect(await mb.database.list()).toEqual({ data: [DATABASE], total: 37 });
  });

  it("sends the get request with the include parameter", async () => {
    const { mb, capture } = clientOver([jsonResponse(DATABASE)]);

    await mb.database.get(1, { include: "tables.fields" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database/1?include=tables.fields",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

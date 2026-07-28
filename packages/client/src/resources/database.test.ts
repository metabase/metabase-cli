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

const TABLE = {
  id: 11,
  name: "orders",
  display_name: "Orders",
  description: null,
  db_id: 1,
  schema: "public",
  entity_type: "entity/TransactionTable",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const IMMEDIATE_POLL = { intervalMs: 1, timeoutMs: 1_000 };

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

  it("sends the schemas request", async () => {
    const { mb, capture } = clientOver([jsonResponse(["public"])]);

    await mb.database.schemas(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database/1/schemas",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the schemas listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse(["public", "reporting"])]);

    expect(await mb.database.schemas(1)).toEqual({
      data: ["public", "reporting"],
      total: null,
    });
  });

  it("percent-encodes the schema name in the schema-tables path", async () => {
    const { mb, capture } = clientOver([jsonResponse([TABLE])]);

    await mb.database.schemaTables(1, "sales/eu west");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database/1/schema/sales%2Feu%20west",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the sync-schema request as a POST without polling when no wait is given", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "ok" })]);

    await mb.database.syncSchema(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database/1/sync_schema",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("polls the database after the sync-schema POST when a wait schedule is given", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "ok" }),
      jsonResponse({ ...DATABASE, initial_sync_status: "incomplete" }),
      jsonResponse(DATABASE),
    ]);

    await mb.database.syncSchema(1, { wait: IMMEDIATE_POLL });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database/1/sync_schema",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/database/1",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/database/1",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports the settled sync status once the wait completes", async () => {
    const { mb } = clientOver([jsonResponse({ status: "ok" }), jsonResponse(DATABASE)]);

    expect(await mb.database.syncSchema(1, { wait: IMMEDIATE_POLL })).toEqual({
      id: 1,
      status: "ok",
      initial_sync_status: "complete",
    });
  });

  it("sends the rescan-values request as a POST", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "ok" })]);

    await mb.database.rescanValues(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/database/1/rescan_values",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers a rescan-values acknowledgement with the id the caller asked about", async () => {
    const { mb } = clientOver([jsonResponse({ status: "ok" })]);

    expect(await mb.database.rescanValues(9)).toEqual({ id: 9, status: "ok" });
  });
});

import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

import type { CsvFile } from "./csv-upload";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const FIELD = {
  id: 101,
  table_id: 11,
  name: "total",
  display_name: "Total",
  description: null,
  base_type: "type/Float",
  semantic_type: null,
  fk_target_field_id: null,
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

const CSV_TEXT = "id,total\n1,9\n";

const CSV_FILE: CsvFile = {
  filename: "rows.csv",
  bytes: new TextEncoder().encode(CSV_TEXT),
};

const CSV_FORM_BODY = {
  parts: [{ name: "file", value: CSV_TEXT, filename: "rows.csv", contentType: "text/csv" }],
};

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("table resource wire requests", () => {
  it("sends the list request with no query parameters", async () => {
    const { mb, capture } = clientOver([jsonResponse([TABLE])]);

    await mb.table.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the bare-array listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TABLE])]);

    expect(await mb.table.list()).toEqual({ data: [TABLE], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TABLE)]);

    await mb.table.get(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TABLE, display_name: "Customers" })]);

    await mb.table.update(11, { display_name: "Customers" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"display_name":"Customers"}',
      },
    ]);
  });

  it("sends the query-metadata request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TABLE, fields: [FIELD] })]);

    await mb.table.queryMetadata(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/query_metadata",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("posts the append-csv request with the file as multipart form data", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 200 })]);

    await mb.table.appendCsv(11, CSV_FILE);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/append-csv",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: CSV_FORM_BODY,
      },
    ]);
  });

  it("posts the replace-csv request with the file as multipart form data", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 200 })]);

    await mb.table.replaceCsv(11, CSV_FILE);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/table/11/replace-csv",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: CSV_FORM_BODY,
      },
    ]);
  });

  it("confirms an append against the table it was asked for", async () => {
    const { mb } = clientOver([new Response(null, { status: 200 })]);

    expect(await mb.table.appendCsv(11, CSV_FILE)).toEqual({ table_id: 11, action: "append" });
  });

  it("confirms a replace against the table it was asked for", async () => {
    const { mb } = clientOver([new Response(null, { status: 200 })]);

    expect(await mb.table.replaceCsv(11, CSV_FILE)).toEqual({ table_id: 11, action: "replace" });
  });
});

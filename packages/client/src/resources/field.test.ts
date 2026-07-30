import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

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

describe("field resource wire requests", () => {
  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(FIELD)]);

    await mb.field.get(101);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...FIELD, semantic_type: "type/Price" })]);

    await mb.field.update(101, { semantic_type: "type/Price" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"semantic_type":"type/Price"}',
      },
    ]);
  });

  it("sends the summary request", async () => {
    const { mb, capture } = clientOver([
      jsonResponse([
        ["count", 200],
        ["distincts", 17],
      ]),
    ]);

    await mb.field.summary(101);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101/summary",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("decodes the summary tuples into counts keyed by the field asked about", async () => {
    const { mb } = clientOver([
      jsonResponse([
        ["count", 200],
        ["distincts", 17],
      ]),
    ]);

    expect(await mb.field.summary(101)).toEqual({ field_id: 101, count: 200, distincts: 17 });
  });

  it("sends the values request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ values: [["a"], ["b"]], field_id: 101 })]);

    await mb.field.values(101);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101/values",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

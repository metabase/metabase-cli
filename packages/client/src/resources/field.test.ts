import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
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

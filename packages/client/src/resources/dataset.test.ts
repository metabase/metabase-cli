import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
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

describe("dataset resource wire requests", () => {
  it("posts the ad-hoc query body verbatim", async () => {
    const { mb, capture } = clientOver([jsonResponse({ status: "completed" })]);

    await mb.dataset.query({
      "lib/type": "mbql/query",
      database: 1,
      stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 2 }],
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dataset",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"lib/type":"mbql/query","database":1,"stages":[{"lib/type":"mbql.stage/mbql","source-table":2}]}',
      },
    ]);
  });
});

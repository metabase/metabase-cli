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

const ANSWER = {
  format_version: 1,
  database: "warehouse",
  engine: "postgres",
  batches: [{ type: "tables", tables: [{ name: "orders", newer_key: { a: 1 } }] }],
  next: { page: 2, opaque: ["x"] },
};

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("metadata-sync resource wire requests", () => {
  it("posts the receiver's database id and cursor to request", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ database: "warehouse", engine: "postgres", format_versions: [1] }),
    ]);

    const request = await mb.metadataSync.request({ database_id: 3, after: { page: 2 } });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/warehouse/metadata/request",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"database_id":3,"after":{"page":2}}',
      },
    ]);
    expect(request).toEqual({ database: "warehouse", engine: "postgres", format_versions: [1] });
  });

  it("sends a request on to changes with the keys a newer receiver added", async () => {
    const { mb, capture } = clientOver([jsonResponse(ANSWER)]);

    await mb.metadataSync.changes({
      database: "warehouse",
      engine: "postgres",
      format_versions: [1],
      schema_filters: { "schema-filters-type": "inclusion" },
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/warehouse/metadata/changes",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"database":"warehouse","engine":"postgres","format_versions":[1],"schema_filters":{"schema-filters-type":"inclusion"}}',
      },
    ]);
  });

  it("returns an answer whole, with the keys it does not know", async () => {
    const { mb } = clientOver([jsonResponse(ANSWER)]);

    const answer = await mb.metadataSync.changes({ database: "warehouse", engine: "postgres" });

    expect(answer).toEqual(ANSWER);
  });

  it("posts the answer to apply as it came and reads the next cursor", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ next: { page: 3 }, counts: { tables_inserted: 1 } }),
    ]);

    const applied = await mb.metadataSync.apply({ database_id: 3, response: ANSWER });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/warehouse/metadata/apply",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ database_id: 3, response: ANSWER }),
      },
    ]);
    expect(applied).toEqual({ next: { page: 3 }, counts: { tables_inserted: 1 } });
  });
});

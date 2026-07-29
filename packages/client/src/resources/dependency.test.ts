import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com",
  credential: { kind: "apiKey", apiKey: "mb_test_key" },
};

const HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_test_key",
};

function clientOver(body: unknown) {
  const capture = captureFetch([jsonResponse(body)]);
  const client = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { client, capture };
}

describe("dependency resource wire requests", () => {
  it("requests direct dependents for an entity", async () => {
    const response = [{ id: 12, type: "card", data: { name: "Orders", type: "question" } }];
    const { client, capture } = clientOver(response);

    expect(await client.dependency.dependents("table", 7)).toEqual(response);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/api/ee/dependencies/graph/dependents?type=table&id=7&include-personal-collections=true",
        method: "GET",
        headers: HEADERS,
        body: null,
      },
    ]);
  });

  it("requests the dependency backfill status", async () => {
    const { client, capture } = clientOver({ complete: true });

    expect(await client.dependency.backfillStatus()).toEqual({ complete: true });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/api/ee/dependencies/backfill-status",
        method: "GET",
        headers: HEADERS,
        body: null,
      },
    ]);
  });
});

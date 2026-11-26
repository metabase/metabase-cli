import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, type FetchScript, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
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

describe("workspace manager resource wire requests", () => {
  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.workspaceManager.delete(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/workspace-manager/3",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends force as a query parameter", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.workspaceManager.delete(3, { force: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/workspace-manager/3?force=true",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

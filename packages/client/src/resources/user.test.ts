import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const CURRENT_USER = {
  id: 1,
  email: "admin@example.com",
  common_name: "Ada Lovelace",
  is_superuser: true,
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

describe("user resource wire requests", () => {
  it("sends the current-user request", async () => {
    const { mb, capture } = clientOver([jsonResponse(CURRENT_USER)]);

    await mb.user.current();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/user/current",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("returns the parsed current user", async () => {
    const { mb } = clientOver([jsonResponse(CURRENT_USER)]);

    expect(await mb.user.current()).toEqual(CURRENT_USER);
  });
});

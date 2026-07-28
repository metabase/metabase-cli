import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { SetupInput } from "../domain/setup";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

// Setup runs before any credential exists, so the wizard's own token is the only thing that
// authorizes it and the transport still sends the profile's (here absent) API key header.
const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SETUP_INPUT: SetupInput = {
  token: "3f2b9a1c-0000-4000-8000-abcdefabcdef",
  user: {
    first_name: "Ada",
    last_name: "Lovelace",
    email: "admin@example.com",
    password: "correct horse battery staple",
  },
  prefs: { site_name: "Acme Analytics", site_locale: "en" },
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

describe("setup resource wire requests", () => {
  it("posts the wizard body verbatim", async () => {
    const { mb, capture } = clientOver([jsonResponse({ id: "session-id" })]);

    await mb.setup.create(SETUP_INPUT);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/setup",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(SETUP_INPUT),
      },
    ]);
  });

  it("returns the parsed setup result", async () => {
    const { mb } = clientOver([jsonResponse({ id: "session-id" })]);

    expect(await mb.setup.create(SETUP_INPUT)).toEqual({ id: "session-id" });
  });
});

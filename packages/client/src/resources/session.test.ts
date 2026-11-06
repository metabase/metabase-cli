import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, probeResponse, TEST_USER_AGENT } from "../testing/fetch-capture";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const CACHED_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.64.2", major: 64, patch: 2 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const UPGRADED_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.65.1", major: 65, patch: 1 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

describe("session resource wire contract", () => {
  it("reads the session properties afresh under a profile handed in", async () => {
    const capture = captureFetch([probeResponse(UPGRADED_SERVER)]);
    const mb = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
      server: CACHED_SERVER,
    });

    const properties = await mb.session.properties();

    expect({ properties, calls: capture.calls }).toEqual({
      properties: { version: { tag: "v1.65.1" } },
      calls: [
        {
          url: `https://mb.example.com/metabase${PROBE_PATH}`,
          method: "GET",
          headers: JSON_READ_HEADERS,
          body: null,
        },
      ],
    });
  });
});

import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.66.0", major: 66, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

const SUITE_RUN = {
  suite_id: 5,
  results: [
    {
      test_type: "card",
      test_id: 34,
      result: { status: "passed", expectations: [], tables: {} },
    },
  ],
};

describe("test-suite resource wire requests", () => {
  it("runs a suite in one bodiless POST and answers each test's result", async () => {
    const capture = captureFetch([jsonResponse(SUITE_RUN)]);
    const mb = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
      server: SERVER,
    });

    expect(await mb.testSuite.run(5)).toEqual(SUITE_RUN);
    expect(capture.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://mb.example.com/metabase/api/ee/data-test-suite/5/run",
    ]);
  });
});

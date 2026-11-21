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
  id: 9,
  suite_id: 5,
  status: "failed",
  members: [
    {
      test_type: "card",
      test_entity_id: "card-test-entity-id-01",
      position: 0,
      status: "passed",
      data_test_run_id: 41,
      test_id: 34,
      name: "revenue is never negative",
      result: { status: "passed", expectations: [], tables: {} },
    },
    {
      test_type: "segment",
      test_entity_id: "segment-test-entity-02",
      position: 1,
      status: "refused",
      error: { error_code: "segment-test.missing-inputs", message: "Missing inputs" },
    },
  ],
};

const RUN_RECORD = {
  id: 9,
  suite_id: 5,
  initiated_by: 1,
  status: "failed",
  start_time: "2026-11-20T10:00:00Z",
  end_time: "2026-11-20T10:00:05Z",
  last_heartbeat: "2026-11-20T10:00:05Z",
  members: [
    {
      test_type: "card",
      test_entity_id: "card-test-entity-id-01",
      position: 0,
      status: "passed",
      data_test_run_id: 41,
    },
  ],
  initiated_by_user: { id: 1, email: "admin@example.com", first_name: null, last_name: null },
};

const SUITE = {
  id: 5,
  entity_id: "suite-entity-id-0000001",
  name: "nightly",
  description: null,
  creator_id: 1,
  created_at: "2026-11-20T09:00:00Z",
  updated_at: "2026-11-20T09:00:00Z",
  members: [
    {
      test_type: "card",
      test_entity_id: "card-test-entity-id-01",
      position: 0,
      status: "readable",
      test_id: 34,
      name: "revenue is never negative",
    },
    {
      test_type: "dashboard",
      test_entity_id: "future-test-entity-03",
      position: 1,
      status: "missing",
    },
  ],
};

function client(capture: ReturnType<typeof captureFetch>) {
  return createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server: SERVER,
  });
}

describe("test-suite resource wire requests", () => {
  it("reads a suite whose member names a test type this client does not know", async () => {
    const capture = captureFetch([jsonResponse(SUITE)]);

    expect(await client(capture).testSuite.get(5)).toEqual(SUITE);
    expect(capture.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://mb.example.com/metabase/api/ee/test-suite/5",
    ]);
  });

  it("runs a suite in one bodiless POST and answers each member's outcome", async () => {
    const capture = captureFetch([jsonResponse(SUITE_RUN)]);

    expect(await client(capture).testSuite.run(5)).toEqual(SUITE_RUN);
    expect(capture.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://mb.example.com/metabase/api/ee/test-suite/5/run",
    ]);
  });

  it("walks a suite's run history by limit and offset until the server's count", async () => {
    const capture = captureFetch([
      jsonResponse({ data: [RUN_RECORD], limit: 50, offset: 0, total: 1 }),
    ]);
    const pages = [];
    for await (const page of client(capture).testSuite.runPages(5)) {
      pages.push(page);
    }

    expect(pages).toEqual([{ items: [RUN_RECORD], total: 1 }]);
    expect(capture.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://mb.example.com/metabase/api/ee/test-suite/5/runs?limit=50&offset=0",
    ]);
  });
});

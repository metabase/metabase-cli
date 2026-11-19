import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  probeResponse,
  routeMissingResponse,
  TEST_USER_AGENT,
  thrownBy,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/capability-error";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const RUN = {
  id: 31,
  test_type: "card",
  test_id: 12,
  initiated_by: 1,
  initiated_by_user: {
    id: 1,
    email: "ci@example.com",
    first_name: "CI",
    last_name: null,
    common_name: "CI",
  },
  start_time: "2026-11-17T10:00:00Z",
  end_time: "2026-11-17T10:00:02Z",
  status: "failed",
  last_heartbeat: "2026-11-17T10:00:02Z",
};

const SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.66.0", major: 66, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

const LICENSED_65 = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

function clientOver(responses: FetchScript, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("data-test-run resource wire requests", () => {
  it("lists the runs of one test type, sending every filter under the server's own name", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ data: [RUN], limit: 5, offset: 10, total: 11 }),
    ]);

    const page = await mb.dataTestRun.list({
      "test-type": "card",
      "test-id": 12,
      statuses: ["failed", "error"],
      "start-time": "past7days",
      limit: 5,
      offset: 10,
    });

    expect(page).toEqual({ data: [RUN], total: 11 });
    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      [
        "GET",
        "https://mb.example.com/metabase/api/ee/data-test-run?test-type=card&test-id=12&statuses=failed&statuses=error&start-time=past7days&limit=5&offset=10",
      ],
    ]);
  });

  it("sends only the test type when nothing narrows the listing", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ data: [], limit: 20, offset: 0, total: 0 }),
    ]);

    expect(await mb.dataTestRun.list({ "test-type": "card" })).toEqual({ data: [], total: 0 });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/data-test-run?test-type=card",
    ]);
  });

  it("gets one run with the result it stored", async () => {
    const detail = {
      ...RUN,
      result: { message: "The card has no inputs.", "error-code": "card-test.missing-inputs" },
      can_read_result: true,
    };
    const { mb, capture } = clientOver([jsonResponse(detail)]);

    expect(await mb.dataTestRun.get(31)).toEqual(detail);
    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/metabase/api/ee/data-test-run/31"],
    ]);
  });

  it("explains an unrouted call on a server older than the run history", async () => {
    const { mb } = clientOver([routeMissingResponse(), probeResponse(LICENSED_65)], LICENSED_65);

    const error = await thrownBy(() => mb.dataTestRun.list({ "test-type": "card" }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v66+ (this server is v1.65.0). Upgrade Metabase to use it.",
      feature: "dataTestRuns",
      since: 66,
      tokenFeature: "transforms-testing",
      serverVersion: "v1.65.0",
    });
  });
});

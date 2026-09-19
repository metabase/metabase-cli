import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const MEMBER_RUN = {
  id: 31,
  transform_id: 7,
  job_run_id: null,
  dag_run_id: 90,
  run_method: "manual",
  status: "succeeded",
  is_active: false,
  start_time: "2026-01-01T00:00:00Z",
  end_time: "2026-01-01T00:01:00Z",
  message: null,
  user_id: 1,
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

// The first generation with DAG reprocess runs.
const SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const OLDER_SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
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

describe("transform-dag-run resource wire requests", () => {
  it("sends the member runs request", async () => {
    const { mb, capture } = clientOver([jsonResponse([MEMBER_RUN])]);

    expect(await mb.transformDagRun.transformRuns(90)).toEqual({
      data: [MEMBER_RUN],
      total: null,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-dag-run/90/transform-runs",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the cancel request", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transformDagRun.cancel(90);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-dag-run/90/cancel",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses before the wire on a server without DAG runs", async () => {
    const { mb, capture } = clientOver([jsonResponse([MEMBER_RUN])], OLDER_SERVER);

    const error = await mb.transformDagRun.transformRuns(90).catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v64+ (this server is v0.63.0). Upgrade Metabase to use it.",
      feature: "transformDagRuns",
      since: 64,
      tokenFeature: null,
      serverVersion: "v0.63.0",
    });
    expect(capture.calls).toEqual([]);
  });
});

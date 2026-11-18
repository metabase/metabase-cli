import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { SegmentTestCreateInput } from "../domain/segment-test";
import { HttpError } from "../http/errors";
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
import { PROBE_PATH } from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const CREATE_BODY: SegmentTestCreateInput = {
  segment_id: 7,
  name: "big orders keeps orders over 100",
  description: null,
  inputs: [
    {
      table: { schema: "public", name: "orders" },
      format: "rows",
      columns: [
        { name: "id", cast_type: "INTEGER" },
        { name: "total", cast_type: "INTEGER" },
      ],
      rows: [
        { id: 1, total: 50 },
        { id: 2, total: 150 },
      ],
    },
  ],
  expectations: [
    { type: "empty", name: "no small orders", sql: "SELECT * FROM {{output}} WHERE total <= 100" },
  ],
};

const LAST_RUN = {
  id: 31,
  test_type: "segment",
  test_id: 12,
  initiated_by: 1,
  start_time: "2026-11-17T10:00:00Z",
  end_time: "2026-11-17T10:00:02Z",
  status: "passed",
  last_heartbeat: "2026-11-17T10:00:02Z",
};

const TEST = {
  id: 12,
  entity_id: "abcdefghijklmnopqrstu",
  segment_id: 7,
  creator_id: 1,
  name: CREATE_BODY.name,
  description: null,
  inputs: CREATE_BODY.inputs,
  expectations: CREATE_BODY.expectations,
  created_at: "2026-11-17T00:00:00Z",
  updated_at: "2026-11-17T00:00:00Z",
  last_run: LAST_RUN,
};

const RUN_RESULT = {
  status: "passed",
  expectations: [{ name: "no small orders", type: "empty", status: "passed" }],
  tables: { mb_test_1a2b: "public.orders" },
};

const REFUSAL = {
  message: "The query under test would not run.",
  "error-code": "segment-test.query-failed",
};

const UNPROCESSABLE_STATUS = 422;

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
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

describe("segment-test resource wire requests", () => {
  it("sends the list request narrowed to one segment", async () => {
    const { mb, capture } = clientOver([jsonResponse([TEST])]);

    await mb.segmentTest.list({ "segment-id": 7 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/segment-test?segment-id=7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers each listed test with its newest run, and no total, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TEST])]);

    expect(await mb.segmentTest.list()).toEqual({ data: [TEST], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TEST)]);

    await mb.segmentTest.get(12);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/segment-test/12",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(TEST)]);

    await mb.segmentTest.create(CREATE_BODY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/segment-test",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(CREATE_BODY),
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the fields given", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TEST, name: "renamed" })]);

    await mb.segmentTest.update(12, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/segment-test/12",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.segmentTest.delete(12);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/segment-test/12",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run request as a bodiless POST and answers the run result", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN_RESULT)]);

    expect(await mb.segmentTest.run(12)).toEqual(RUN_RESULT);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/segment-test/12/run",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("surfaces a run refusal as an HttpError whose code starts with segment-test.", async () => {
    const { mb } = clientOver([jsonResponse(REFUSAL, UNPROCESSABLE_STATUS)]);

    const error = await thrownBy(() => mb.segmentTest.run(12));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(UNPROCESSABLE_STATUS);
    expect(error.errorCode).toBe("segment-test.query-failed");
    expect(error.userMessage).toBe("The query under test would not run.");
  });

  it("explains an unrouted call on a server older than segment tests, though it tests transforms", async () => {
    const { mb, capture } = clientOver(
      [routeMissingResponse(), probeResponse(LICENSED_65)],
      LICENSED_65,
    );

    const error = await thrownBy(() => mb.segmentTest.list());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v66+ (this server is v1.65.0). Upgrade Metabase to use it.",
      feature: "segmentTests",
      since: 66,
      tokenFeature: "transforms-testing",
      serverVersion: "v1.65.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/segment-test",
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });
});

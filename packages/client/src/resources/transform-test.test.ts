import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import {
  isTransformTestRefusalCode,
  type TransformTestCreateInput,
} from "../domain/transform-test";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
  thrownBy,
  type FetchScript,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const CREATE_BODY: TransformTestCreateInput = {
  transform_id: 7,
  name: "orders keep every row",
  description: null,
  inputs: [
    {
      table: { schema: "public", name: "orders" },
      format: "rows",
      columns: [{ name: "id", cast_type: "INTEGER" }],
      rows: [{ id: 1 }],
    },
  ],
  expectations: [{ type: "empty", name: "no nulls", sql: "SELECT * FROM out WHERE id IS NULL" }],
};

const TEST = {
  id: 12,
  entity_id: "abcdefghijklmnopqrstu",
  transform_id: 7,
  creator_id: 1,
  name: "orders keep every row",
  description: null,
  inputs: CREATE_BODY.inputs,
  expectations: CREATE_BODY.expectations,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const RUN_RESULT = {
  status: "passed",
  expectations: [{ name: "no nulls", type: "empty", status: "passed" }],
  tables: { mb_test_1a2b: "public.orders" },
};

const REFUSAL = {
  message: "The h2 database of this transform does not support transform testing.",
  "error-code": "transform-test.unsupported-driver",
  "transform-id": 7,
};

const MALLI_ENVELOPE = {
  errors: { name: "value must be a non-blank string." },
  "specific-errors": { name: ["should be at least 1 character"] },
};

const UNSUPPORTED_DRIVER_STATUS = 422;
const BAD_REQUEST_STATUS = 400;

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
  version: { tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": false },
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

describe("transform-test resource wire requests", () => {
  it("sends the list request narrowed to one transform", async () => {
    const { mb, capture } = clientOver([jsonResponse([TEST])]);

    await mb.transformTest.list({ "transform-id": 7 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test?transform-id=7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TEST])]);

    expect(await mb.transformTest.list()).toEqual({ data: [TEST], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TEST)]);

    await mb.transformTest.get(12);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test/12",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(TEST)]);

    await mb.transformTest.create(CREATE_BODY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(CREATE_BODY),
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the fields given", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TEST, name: "renamed" })]);

    await mb.transformTest.update(12, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test/12",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transformTest.delete(12);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test/12",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run request as a bodiless POST and answers the run result", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN_RESULT)]);

    expect(await mb.transformTest.run(12)).toEqual(RUN_RESULT);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test/12/run",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("surfaces a run refusal as an HttpError whose code is in the refusal vocabulary", async () => {
    const { mb } = clientOver([jsonResponse(REFUSAL, UNSUPPORTED_DRIVER_STATUS)]);

    const error = await thrownBy(() => mb.transformTest.run(12));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(UNSUPPORTED_DRIVER_STATUS);
    expect(error.errorCode).toBe("transform-test.unsupported-driver");
    assert(error.errorCode !== null, "expected an error code");
    expect(isTransformTestRefusalCode(error.errorCode)).toBe(true);
    expect(error.userMessage).toBe(
      "The h2 database of this transform does not support transform testing.",
    );
  });

  it("surfaces a create rejection without a code as the field errors it carries", async () => {
    const { mb } = clientOver([jsonResponse(MALLI_ENVELOPE, BAD_REQUEST_STATUS)]);

    const error = await thrownBy(() => mb.transformTest.create(CREATE_BODY));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(BAD_REQUEST_STATUS);
    expect(error.errorCode).toBeNull();
    expect(error.fieldErrors).toEqual({ name: "value must be a non-blank string." });
    expect(error.specificFieldErrors).toEqual({ name: "should be at least 1 character" });
  });

  it("refuses a server without the token feature before any request leaves", async () => {
    const { mb, capture } = clientOver([], UNLICENSED_SERVER);

    const error = await thrownBy(() => mb.transformTest.list());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.userMessage).toBe(
      "This operation requires the 'transforms-testing' premium feature (not enabled on this server).",
    );
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'transforms-testing' premium feature (not enabled on this server).",
      feature: "transformTests",
      since: 65,
      tokenFeature: "transforms-testing",
      serverVersion: "v1.65.0",
    });
    expect(capture.calls).toEqual([]);
  });
});

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { createClient } from "../client";
import {
  DATA_TEST_TYPES,
  type DataTestDefinition,
  type DataTestType,
  isDataTestCode,
} from "../domain/data-test";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  premiumRefusalResponse,
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

const DEFINITION: DataTestDefinition = {
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
  inputs: DEFINITION.inputs,
  expectations: DEFINITION.expectations,
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
  version: { kind: "release", tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-testing": false },
});

const LICENSED_64 = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.64.0", major: 64, patch: 0 },
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

describe("data-test resource wire requests for a transform test", () => {
  it("reports no total for the listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TEST])]);

    expect(await mb.dataTest.list("transform")).toEqual({ data: [TEST], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TEST)]);

    await mb.dataTest.get("transform", 12);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test/12",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the fields given", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TEST, name: "renamed" })]);

    await mb.dataTest.update("transform", 12, { name: "renamed" });

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

    await mb.dataTest.delete("transform", 12);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transform-test/12",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("surfaces a run refusal as an HttpError carrying a data test code", async () => {
    const { mb } = clientOver([jsonResponse(REFUSAL, UNSUPPORTED_DRIVER_STATUS)]);

    const error = await thrownBy(() => mb.dataTest.run("transform", 12));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(UNSUPPORTED_DRIVER_STATUS);
    expect(error.errorCode).toBe("transform-test.unsupported-driver");
    assert(error.errorCode !== null, "expected an error code");
    expect(isDataTestCode(error.errorCode)).toBe(true);
    expect(error.userMessage).toBe(
      "The h2 database of this transform does not support transform testing.",
    );
  });

  it("keeps the tables a refusal names", async () => {
    const { mb } = clientOver([
      jsonResponse(
        {
          message: "The transform reads PUBLIC.PEOPLE, which has no test input.",
          "error-code": "transform-test.missing-inputs",
          tables: ["PUBLIC.PEOPLE"],
        },
        BAD_REQUEST_STATUS,
      ),
    ]);

    const error = await thrownBy(() => mb.dataTest.run("transform", 12));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.tables).toEqual(["PUBLIC.PEOPLE"]);
  });

  it("recognises a data test code by its type's prefix, including one newer than this client", () => {
    expect(
      [
        "transform-test.some-new-refusal",
        "card-test.unused-inputs",
        "dashboard-test.missing-inputs",
        "some-other.code",
      ].map(isDataTestCode),
    ).toEqual([true, true, false, false]);
  });

  it("surfaces a create rejection without a code as the field errors it carries", async () => {
    const { mb } = clientOver([jsonResponse(MALLI_ENVELOPE, BAD_REQUEST_STATUS)]);

    const error = await thrownBy(() => mb.dataTest.create("transform", 7, DEFINITION));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(BAD_REQUEST_STATUS);
    expect(error.errorCode).toBeNull();
    expect(error.fieldErrors).toEqual({ name: "value must be a non-blank string." });
    expect(error.specificFieldErrors).toEqual({ name: "should be at least 1 character" });
  });

  it("explains an unrouted call on a server older than the route, whatever its token grants", async () => {
    const { mb, capture } = clientOver(
      [routeMissingResponse(), probeResponse(LICENSED_64)],
      LICENSED_64,
    );

    const error = await thrownBy(() => mb.dataTest.list("transform"));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v65+ (this server is v1.64.0). Upgrade Metabase to use it.",
      feature: "transformTests",
      since: 65,
      tokenFeature: "transforms-testing",
      serverVersion: "v1.64.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/transform-test",
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });

  it("explains a premium refusal as the missing transforms-testing token", async () => {
    const { mb, capture } = clientOver(
      [premiumRefusalResponse("Transforms testing"), probeResponse(UNLICENSED_SERVER)],
      UNLICENSED_SERVER,
    );

    const error = await thrownBy(() => mb.dataTest.list("transform"));

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
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/transform-test",
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });
});

describe.each(DATA_TEST_TYPES)("data-test resource wire requests for a %s test", (type) => {
  const { transform_id: _transformId, ...shared } = TEST;
  const stored = { ...shared, [`${type}_id`]: 7, parameters: {} };
  const base = `https://mb.example.com/metabase/api/ee/${type}-test`;

  it("lists the tests of one entity under the type's own filter", async () => {
    const { mb, capture } = clientOver([jsonResponse([stored])]);

    await mb.dataTest.list(type, 7);

    expect(capture.calls.map((call) => call.url)).toEqual([`${base}?${type}-id=7`]);
  });

  it("asks for the tests of archived entities only when told to", async () => {
    const { mb, capture } = clientOver([jsonResponse([stored]), jsonResponse([stored])]);

    await mb.dataTest.list(type, null, { "include-archived": true });
    await mb.dataTest.list(type, null);

    expect(capture.calls.map((call) => call.url)).toEqual([`${base}?include-archived=true`, base]);
  });

  it("creates a test with the entity's id under the type's own key", async () => {
    const { mb, capture } = clientOver([jsonResponse(stored)]);
    const definition = type === "action" ? { ...DEFINITION, parameters: {} } : DEFINITION;

    await mb.dataTest.create(type, 7, definition);

    expect(capture.calls.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: "POST", url: base, body: JSON.stringify({ ...definition, [`${type}_id`]: 7 }) },
    ]);
  });

  it("runs a test in one bodiless POST", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN_RESULT)]);

    expect(await mb.dataTest.run(type, 12)).toEqual(RUN_RESULT);
    expect(capture.calls.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: "POST", url: `${base}/12/run`, body: null },
    ]);
  });
});

describe("data-test resource path", () => {
  it("refuses a type outside the vocabulary before sending, so a caller outside TypeScript cannot reach another path", async () => {
    const { mb, capture } = clientOver([]);
    // Stands for a caller with no type checker, whose type is any string.
    const unchecked = z.custom<DataTestType>(() => true).parse("../../api/card/1#");

    await expect(mb.dataTest.delete(unchecked, 1)).rejects.toThrow(z.ZodError);
    expect(capture.calls).toEqual([]);
  });
});

describe.each(["card", "segment", "measure", "action"] as const)(
  "data-test resource refusals for a %s test",
  (type) => {
    it("explains an unrouted call on a server without the type as the type's own feature", async () => {
      const { mb, capture } = clientOver([routeMissingResponse(), probeResponse(SERVER)], SERVER);

      const error = await thrownBy(() => mb.dataTest.get(type, 12));

      assert(error instanceof CapabilityError, "expected CapabilityError");
      expect(error.developerDetail).toEqual({
        reason: "version-too-old",
        detail:
          "This operation requires Metabase v66+ (this server is v1.65.0). Upgrade Metabase to use it.",
        feature: `${type}Tests`,
        since: 66,
        tokenFeature: "transforms-testing",
        serverVersion: "v1.65.0",
      });
      expect(capture.calls.map((call) => call.url)).toEqual([
        `https://mb.example.com/metabase/api/ee/${type}-test/12`,
        `https://mb.example.com/metabase${PROBE_PATH}`,
      ]);
    });
  },
);

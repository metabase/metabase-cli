import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const FIELD = {
  id: 101,
  table_id: 11,
  name: "total",
  display_name: "Total",
  description: null,
  base_type: "type/Float",
  semantic_type: null,
  fk_target_field_id: null,
};

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

// The first server whose fields carry a sensitivity label, and the last before it.
const SERVER_64 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const SERVER_63 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.63.4", major: 63, patch: 4 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

function clientOver(responses: Array<Response>, server = SERVER_64) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("field resource wire requests", () => {
  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(FIELD)]);

    await mb.field.get(101);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...FIELD, semantic_type: "type/Price" })]);

    await mb.field.update(101, { semantic_type: "type/Price" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"semantic_type":"type/Price"}',
      },
    ]);
  });

  it("updates a field on a server without the sensitivity column when the body has no label", async () => {
    const { mb, capture } = clientOver([jsonResponse(FIELD)], SERVER_63);

    await mb.field.update(101, { semantic_type: "type/Price" });

    expect(capture.calls.map((call) => call.body)).toEqual(['{"semantic_type":"type/Price"}']);
  });

  it("sends the sensitivity label as a PUT carrying only that key", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...FIELD, data_sensitivity: "PII" })]);

    await mb.field.update(101, { data_sensitivity: "PII" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"data_sensitivity":"PII"}',
      },
    ]);
  });

  it("sends a withdrawn sensitivity label as null", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...FIELD, data_sensitivity: null })]);

    await mb.field.update(101, { data_sensitivity: null });

    expect(capture.calls.map((call) => call.body)).toEqual(['{"data_sensitivity":null}']);
  });

  it("refuses the sensitivity label before the wire on a server without the column", async () => {
    const { mb, capture } = clientOver([], SERVER_63);

    const error = await thrownBy(() => mb.field.update(101, { data_sensitivity: "PII" }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v64+ (this server is v0.63.4). Upgrade Metabase to use it.",
      feature: "fieldDataSensitivity",
      since: 64,
      tokenFeature: null,
      serverVersion: "v0.63.4",
    });
    expect(capture.calls).toEqual([]);
  });

  it("sends the search request with the value and limit as the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([[14, "Marilyne Mohr"]])]);

    await mb.field.search(101, 102, { value: "Ma ry", limit: 3 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101/search/102?value=Ma+ry&limit=3",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends a bounded search with only the limit", async () => {
    const { mb, capture } = clientOver([jsonResponse([[14]])]);

    await mb.field.search(101, 101, { limit: 10 });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/field/101/search/101?limit=10",
    ]);
  });

  it("answers the search matches as the rows the server sent", async () => {
    const { mb } = clientOver([
      jsonResponse([
        [14, "Marilyne Mohr"],
        [36, "Margot Farrell"],
      ]),
    ]);

    expect(await mb.field.search(101, 102, { value: "Ma" })).toEqual([
      [14, "Marilyne Mohr"],
      [36, "Margot Farrell"],
    ]);
  });

  it("sends the remapping request with the value as the query string, accepting any content type", async () => {
    const { mb, capture } = clientOver([jsonResponse([20, "Peter Watsica"])]);

    await mb.field.remapping(101, 102, { value: "20" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101/remapping/102?value=20",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers the remapped pair the server found", async () => {
    const { mb } = clientOver([jsonResponse([20, "Peter Watsica"])]);

    expect(await mb.field.remapping(101, 102, { value: "20" })).toEqual([20, "Peter Watsica"]);
  });

  it("reads a remapping 204 as null, the server's answer when no row matches", async () => {
    const { mb } = clientOver([new Response(null, { status: 204 })]);

    expect(await mb.field.remapping(101, 102, { value: "999" })).toBe(null);
  });

  it("sends the summary request", async () => {
    const { mb, capture } = clientOver([
      jsonResponse([
        ["count", 200],
        ["distincts", 17],
      ]),
    ]);

    await mb.field.summary(101);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101/summary",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("decodes the summary tuples into counts keyed by the field asked about", async () => {
    const { mb } = clientOver([
      jsonResponse([
        ["count", 200],
        ["distincts", 17],
      ]),
    ]);

    expect(await mb.field.summary(101)).toEqual({ field_id: 101, count: 200, distincts: 17 });
  });

  it("sends the values request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ values: [["a"], ["b"]], field_id: 101 })]);

    await mb.field.values(101);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/field/101/values",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { TransformIndexStructured } from "../domain/transform-index";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const STRUCTURED: TransformIndexStructured = {
  kind: "btree",
  name: "idx_one",
  columns: [{ name: "one" }],
};

const UNIQUE_STRUCTURED: TransformIndexStructured = { ...STRUCTURED, unique: true };

const REQUEST = {
  id: 7,
  transform_id: 1,
  index_name: "idx_one",
  structured: STRUCTURED,
  status: "create-pending",
  error_message: null,
  created_by: 2,
  created_at: "2026-07-23T15:00:00Z",
  updated_at: "2026-07-23T15:00:00Z",
  last_executed_at: null,
};

const INDEX = {
  metabase_managed: true,
  present_in_warehouse: false,
  name: "idx_one",
  kind: "btree",
  key_columns: ["one"],
  include_columns: [],
  is_unique: false,
  is_primary: false,
  is_valid: true,
  partial_predicate: null,
  access_method: null,
  request: REQUEST,
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

function clientOver(responses: FetchScript) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("transform-index resource wire requests", () => {
  it("sends the list request scoped to the transform", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [INDEX] })]);

    await mb.transformIndex.list(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/index?transform-id=1",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("unwraps the list envelope and reports no total, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse({ data: [INDEX] })]);

    expect(await mb.transformIndex.list(1)).toEqual({ data: [INDEX], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(REQUEST)]);

    await mb.transformIndex.get(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/index/request/7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(REQUEST)]);

    await mb.transformIndex.create({ transform_id: 1, structured: STRUCTURED });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/index/request",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"transform_id":1,"structured":{"kind":"btree","name":"idx_one","columns":[{"name":"one"}]}}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying the replacement definition", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...REQUEST, status: "update-pending" })]);

    await mb.transformIndex.update(7, { structured: UNIQUE_STRUCTURED });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/index/request/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"structured":{"kind":"btree","name":"idx_one","columns":[{"name":"one"}],"unique":true}}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transformIndex.delete(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/index/request/7",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { DataActionCreateInput } from "../domain/data-action";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  jsonResponse,
  probeResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/capability-error";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const ACTION_V64 = {
  id: 7,
  name: "Rename order",
  description: null,
  type: "query",
  model_id: null,
  database_id: 2,
  dataset_query: {
    database: 2,
    type: "native",
    native: { query: "UPDATE orders SET note = {{note}} WHERE id = {{id}}" },
  },
  parameters: [{ id: "id", type: "number/=" }],
  visualization_settings: null,
  archived: false,
  public_uuid: null,
  entity_id: "ccccccccccccccccccccc",
  creator_id: 1,
  created_at: "2026-01-02T03:04:05.678Z",
  updated_at: "2026-01-02T03:04:05.678Z",
};

const ACTION = { ...ACTION_V64, collection_id: 3 };

const CREATE_BODY: DataActionCreateInput = {
  name: "Rename order",
  type: "query",
  database_id: 2,
  collection_id: 3,
  dataset_query: {
    database: 2,
    type: "native",
    native: { query: "UPDATE orders SET note = {{note}} WHERE id = {{id}}" },
  },
  parameters: [{ id: "id", type: "number/=", target: ["variable", ["template-tag", "id"]] }],
};

const HEAD_SERVER = createServerProfile({
  edition: "oss",
  version: { kind: "release", tag: "v0.65.0", major: 65, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const V64_SERVER = createServerProfile({
  edition: "oss",
  version: { kind: "release", tag: "v0.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

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

function clientOver(responses: Array<Response>, server: ServerProfile = HEAD_SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("data action resource wire requests", () => {
  it("sends the list request without a query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([ACTION])]);

    const result = await mb.dataAction.list();

    expect(result).toEqual({ data: [ACTION], total: null });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reads a data action without a collection on a server whose data actions have none", async () => {
    const { mb } = clientOver([jsonResponse([ACTION_V64])], V64_SERVER);

    const result = await mb.dataAction.list();

    expect(result).toEqual({ data: [{ ...ACTION_V64, collection_id: null }], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(ACTION)]);

    await mb.dataAction.get(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action/7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the full body", async () => {
    const { mb, capture } = clientOver([jsonResponse(ACTION)]);

    await mb.dataAction.create(CREATE_BODY);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(CREATE_BODY),
      },
    ]);
  });

  it("explains a create rejected by a server whose data actions need a model", async () => {
    const { mb, capture } = clientOver(
      [
        jsonResponse({ errors: { model_id: "value must be an integer greater than zero." } }, 400),
        probeResponse(V64_SERVER),
      ],
      V64_SERVER,
    );

    await expect(mb.dataAction.create(CREATE_BODY)).rejects.toBeInstanceOf(CapabilityError);
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/action",
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });

  it("sends the update request with only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(ACTION)]);

    await mb.dataAction.update(7, { name: "Rename an order" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ name: "Rename an order" }),
      },
    ]);
  });

  it("sends archive as an update that sets archived", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...ACTION, archived: true })]);

    await mb.dataAction.archive(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ archived: true }),
      },
    ]);
  });

  it("sends the delete request", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.dataAction.delete(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action/7",
        method: "DELETE",
        headers: { accept: "*/*", "user-agent": TEST_USER_AGENT, "x-api-key": "mb_wire_test_key" },
        body: null,
      },
    ]);
  });

  it("sends the execute request with the parameter values", async () => {
    const { mb, capture } = clientOver([jsonResponse({ "rows-affected": 1 })]);

    const result = await mb.dataAction.execute(7, { parameters: { id: 1, note: "rush" } });

    expect(result).toEqual({ "rows-affected": 1 });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action/7/execute",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ parameters: { id: 1, note: "rush" } }),
      },
    ]);
  });
});

import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { DataActionCreateInput, DataActionUpdateInput } from "../domain/data-action";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  jsonResponse,
  probeResponse,
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
  collection_id: 3,
  dataset_query: {
    database: 2,
    type: "native",
    native: { query: "UPDATE orders SET note = {{note}} WHERE id = {{id}}" },
  },
  parameters: [{ id: "id", type: "number/=", target: ["variable", ["template-tag", "id"]] }],
};

const TABLE_ACTION = {
  ...ACTION,
  id: 8,
  name: "Rename customer",
  type: "implicit",
  kind: "row/update",
  table_id: 4,
  dataset_query: undefined,
  database_id: undefined,
  parameters: [
    { id: "id", type: "number/=" },
    { id: "full_name", type: "string/=" },
  ],
};

const TABLE_ACTION_CREATE_BODY: DataActionCreateInput = {
  name: "Rename customer",
  type: "implicit",
  kind: "row/update",
  table_id: 4,
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

  it("sends the create request of an implicit action on a table and reads back its kind and table", async () => {
    const { mb, capture } = clientOver([jsonResponse(TABLE_ACTION)]);

    const created = await mb.dataAction.create(TABLE_ACTION_CREATE_BODY);

    expect(created).toMatchObject({ type: "implicit", kind: "row/update", table_id: 4 });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/action",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(TABLE_ACTION_CREATE_BODY),
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

  it("refuses a collection_id before the wire on a server whose data actions have no collection", async () => {
    const { mb, capture } = clientOver([probeResponse(V64_SERVER)], V64_SERVER);

    const error = await thrownBy(() => mb.dataAction.update(7, { collection_id: 3 }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v65+ (this server is v0.64.0). Upgrade Metabase to use it.",
      feature: "dataActionCollections",
      since: 65,
      tokenFeature: null,
      serverVersion: "v0.64.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      `https://mb.example.com/metabase${PROBE_PATH}`,
    ]);
  });

  it("refuses a table_id before the wire on a server whose data actions need a model", async () => {
    const { mb, capture } = clientOver([probeResponse(V64_SERVER)], V64_SERVER);

    const error = await thrownBy(() => mb.dataAction.update(7, { table_id: 12 }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v65+ (this server is v0.64.0). Upgrade Metabase to use it.",
      feature: "dataActionsWithoutModel",
      since: 65,
      tokenFeature: null,
      serverVersion: "v0.64.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      `https://mb.example.com/metabase${PROBE_PATH}`,
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

  it.each([
    { "rows-updated": 1 },
    { "rows-deleted": 1 },
    { "created-row": { id: 9, full_name: "Ada" } },
  ])("reads the result %j of an implicit action", async (body) => {
    const { mb } = clientOver([jsonResponse(body)]);

    const result = await mb.dataAction.execute(8, { parameters: { id: 9 } });

    expect(result).toEqual(body);
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

describe("data action create input", () => {
  it("takes a query body and an implicit body", () => {
    expect(DataActionCreateInput.safeParse(CREATE_BODY).success).toBe(true);
    expect(DataActionCreateInput.safeParse(TABLE_ACTION_CREATE_BODY).success).toBe(true);
  });

  it("refuses an implicit body without its table or with a query, and a query body with a database", () => {
    const implicit = {
      name: "Rename customer",
      type: "implicit",
      kind: "row/update",
      table_id: 4,
    };

    expect(DataActionCreateInput.safeParse({ ...implicit, table_id: undefined }).success).toBe(
      false,
    );
    expect(
      DataActionCreateInput.safeParse({ ...implicit, dataset_query: CREATE_BODY.dataset_query })
        .success,
    ).toBe(false);
    expect(DataActionCreateInput.safeParse({ ...CREATE_BODY, database_id: 2 }).success).toBe(false);
  });
});

describe("data action update input", () => {
  it("takes a query patch, an implicit patch, and a patch of neither", () => {
    expect(
      DataActionUpdateInput.safeParse({ dataset_query: CREATE_BODY.dataset_query }).success,
    ).toBe(true);
    expect(DataActionUpdateInput.safeParse({ kind: "row/delete", table_id: 4 }).success).toBe(true);
    expect(DataActionUpdateInput.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("refuses a patch of both a query and a table, and one with a database", () => {
    expect(
      DataActionUpdateInput.safeParse({ dataset_query: CREATE_BODY.dataset_query, table_id: 4 })
        .success,
    ).toBe(false);
    expect(DataActionUpdateInput.safeParse({ database_id: 2 }).success).toBe(false);
  });
});

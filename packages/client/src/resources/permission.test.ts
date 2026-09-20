import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const ADMIN_DATABASE_PERMISSIONS = {
  "view-data": "unrestricted",
  "create-queries": "query-builder-and-native",
  download: { schemas: "full" },
  "data-model": { schemas: "all" },
  details: "yes",
  transforms: "yes",
};

// A group with one schema collapsed to a value, one schema split per table, and every key the
// server leaves out at its least permissive value.
const GRAPH = {
  revision: 7,
  groups: {
    "2": { "1": ADMIN_DATABASE_PERMISSIONS },
    "5": {
      "1": {
        "view-data": { public: "unrestricted", staging: { "11": "sandboxed" } },
        "create-queries": { public: { "11": "query-builder", "12": "query-builder-and-native" } },
        download: { schemas: { public: "limited" } },
      },
    },
  },
};

const SERVER_58 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server: SERVER_58,
  });
  return { mb, capture };
}

describe("permission resource wire requests", () => {
  it("sends the whole-graph request", async () => {
    const { mb, capture } = clientOver([jsonResponse(GRAPH)]);

    await mb.permission.graph();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/graph",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the database id on the path of the database graph request", async () => {
    const { mb, capture } = clientOver([jsonResponse(GRAPH)]);

    await mb.permission.databaseGraph(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/graph/db/1",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the group id on the path of the group graph request", async () => {
    const { mb, capture } = clientOver([jsonResponse(GRAPH)]);

    await mb.permission.groupGraph(5);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/permissions/graph/group/5",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers the graph with collapsed and per-table values as the server keys them", async () => {
    const { mb } = clientOver([jsonResponse(GRAPH)]);

    expect(await mb.permission.graph()).toEqual(GRAPH);
  });

  it("reads a fresh server's graph as revision zero over no groups", async () => {
    const { mb } = clientOver([jsonResponse({ revision: 0, groups: {} })]);

    expect(await mb.permission.graph()).toEqual({ revision: 0, groups: {} });
  });

  it("refuses a view-data value outside the vocabulary the server can emit", async () => {
    const { mb } = clientOver([
      jsonResponse({ revision: 7, groups: { "5": { "1": { "view-data": "controlled" } } } }),
    ]);

    const error = await thrownBy(() => mb.permission.graph());

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.message).toBe(
      'On Metabase v0.58.0 the response shape was unexpected:\n  groups.5.1["view-data"]: Invalid input',
    );
  });
});

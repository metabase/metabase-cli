import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { TransformLensQueryInput } from "../domain/transform-inspector";
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

const TABLE = {
  table_id: 12,
  table_name: "orders",
  schema: "public",
  db_id: 1,
  column_count: 1,
  fields: [{ id: 101, name: "id", display_name: "ID", base_type: "type/Integer" }],
};

const INSPECTION = {
  name: "Daily orders",
  description: null,
  status: "ready",
  sources: [TABLE],
  target: { ...TABLE, table_id: 13, table_name: "daily_orders" },
  visited_fields: { all: [101] },
  available_lenses: [{ id: "overview", display_name: "Overview", complexity: { level: "fast" } }],
};

const QUERY = { "lib/type": "mbql/query", database: 1, stages: [{ "source-table": 13 }] };

const LENS = {
  id: "overview",
  display_name: "Overview",
  sections: [{ id: "counts", title: "Counts", layout: "flat" }],
  cards: [
    {
      id: "row-count",
      section_id: "counts",
      title: "Rows",
      display: "scalar",
      dataset_query: QUERY,
    },
  ],
  drill_lens_triggers: [
    {
      lens_id: "unmatched-rows",
      condition: { name: "unmatched" },
      params: { join_step: 2 },
    },
  ],
};

const QUERY_RESULT = { status: "completed", row_count: 1, data: { rows: [[3]], cols: [] } };

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

// The first generation with the inspector, licensed for Python transforms.
const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-python": true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-python": false },
});

const OLDER_LICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { "transforms-python": true },
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

describe("transform-inspector resource wire requests", () => {
  it("sends the discovery request", async () => {
    const { mb, capture } = clientOver([jsonResponse(INSPECTION)]);

    expect(await mb.transformInspector.discover(7)).toEqual(INSPECTION);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transforms/7/inspect",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the lens request with the drill parameters in the query and the id encoded", async () => {
    const { mb, capture } = clientOver([jsonResponse(LENS)]);

    expect(await mb.transformInspector.lens(7, "unmatched rows", { join_step: 2 })).toEqual(LENS);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transforms/7/inspect/unmatched%20rows?join_step=2",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the lens query with the card query and lens parameters in the body", async () => {
    const { mb, capture } = clientOver([jsonResponse(QUERY_RESULT)]);
    const input: TransformLensQueryInput = { query: QUERY, lens_params: { join_step: 2 } };

    expect(await mb.transformInspector.query(7, "overview", input)).toEqual(QUERY_RESULT);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/transforms/7/inspect/overview/query",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify(input),
      },
    ]);
  });

  it("refuses before the wire on a server without the Python transforms token", async () => {
    const { mb, capture } = clientOver([], UNLICENSED_SERVER);

    const error = await mb.transformInspector.discover(7).catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'transforms-python' premium feature (not enabled on this server).",
      feature: "transformInspector",
      since: 60,
      tokenFeature: "transforms-python",
      serverVersion: "v1.60.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("refuses before the wire on a server older than the inspector, whatever its token grants", async () => {
    const { mb, capture } = clientOver([], OLDER_LICENSED_SERVER);

    const error = await mb.transformInspector.discover(7).catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v60+ (this server is v1.59.0). Upgrade Metabase to use it.",
      feature: "transformInspector",
      since: 60,
      tokenFeature: "transforms-python",
      serverVersion: "v1.59.0",
    });
    expect(capture.calls).toEqual([]);
  });
});

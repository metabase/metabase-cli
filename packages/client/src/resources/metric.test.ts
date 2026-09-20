import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { MetricDefinition } from "../domain/metric";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
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

const REVENUE_UUID = "6f1b6c3e-0000-4000-8000-000000000001";
const ORDERS_UUID = "6f1b6c3e-0000-4000-8000-000000000002";
const CREATED_AT_DIMENSION = "9c2d4e5f-0000-4000-8000-00000000000a";

const AVERAGE_ORDER: MetricDefinition = {
  expression: [
    "/",
    {},
    ["metric", { "lib/uuid": REVENUE_UUID }, 42],
    ["measure", { "lib/uuid": ORDERS_UUID }, 7],
  ],
  filters: [
    {
      "lib/uuid": REVENUE_UUID,
      filter: [
        "time-interval",
        {},
        ["dimension", { "temporal-unit": "month" }, CREATED_AT_DIMENSION],
        -12,
        "month",
      ],
    },
  ],
  projections: [
    {
      type: "metric",
      id: 42,
      "lib/uuid": REVENUE_UUID,
      projection: [["dimension", { "temporal-unit": "month" }, CREATED_AT_DIMENSION]],
    },
  ],
};

const AVERAGE_ORDER_JSON =
  '{"definition":{"expression":["/",{},["metric",{"lib/uuid":"6f1b6c3e-0000-4000-8000-000000000001"},42],["measure",{"lib/uuid":"6f1b6c3e-0000-4000-8000-000000000002"},7]],"filters":[{"lib/uuid":"6f1b6c3e-0000-4000-8000-000000000001","filter":["time-interval",{},["dimension",{"temporal-unit":"month"},"9c2d4e5f-0000-4000-8000-00000000000a"],-12,"month"]}],"projections":[{"type":"metric","id":42,"lib/uuid":"6f1b6c3e-0000-4000-8000-000000000001","projection":[["dimension",{"temporal-unit":"month"},"9c2d4e5f-0000-4000-8000-00000000000a"]]}]}}';

const QUERY_RESULT = {
  status: "completed",
  row_count: 1,
  data: { rows: [["2026-01-01T00:00:00Z", 12.5]], cols: [{ name: "created_at" }, { name: "avg" }] },
};

const BREAKOUT_VALUES = {
  values: ["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
  col: { name: "created_at", display_name: "Created At", base_type: "type/DateTime" },
};

const CREATED_AT = {
  id: CREATED_AT_DIMENSION,
  name: "created_at",
  display_name: "Created At",
  effective_type: "type/DateTime",
  semantic_type: "type/CreationTimestamp",
  has_field_values: "none",
  status: "status/active",
  sources: [{ type: "field", "field-id": 301 }],
  group: { id: "table-11", type: "main", display_name: "Orders" },
  default_temporal_unit: "month",
  default: true,
};

const LISTING = {
  added: [CREATED_AT],
  addable: [
    {
      group: { id: "table-12", type: "connection", display_name: "Customers" },
      dimensions: [
        {
          id: "9c2d4e5f-0000-4000-8000-00000000000b",
          name: "country",
          display_name: "Country",
          effective_type: "type/Text",
          semantic_type: "type/Country",
          mapping_target: ["field", { "source-field": 305 }, 412],
        },
      ],
    },
  ],
};

const SERVER_64 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const SERVER_63 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const SERVER_59 = createServerProfile({
  edition: "oss",
  version: { tag: "v0.59.0", major: 59, patch: 0 },
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

describe("metric resource wire requests", () => {
  it("sends the definition under a `definition` key to the dataset route", async () => {
    const { mb, capture } = clientOver([jsonResponse(QUERY_RESULT)]);

    await mb.metric.query(AVERAGE_ORDER);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/metric/dataset",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: AVERAGE_ORDER_JSON,
      },
    ]);
  });

  it("answers the query result envelope", async () => {
    const { mb } = clientOver([jsonResponse(QUERY_RESULT)]);

    expect(await mb.metric.query(AVERAGE_ORDER)).toEqual(QUERY_RESULT);
  });

  it("sends the same definition to the breakout values route", async () => {
    const { mb, capture } = clientOver([jsonResponse(BREAKOUT_VALUES)]);

    await mb.metric.breakoutValues(AVERAGE_ORDER);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/metric/breakout-values",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: AVERAGE_ORDER_JSON,
      },
    ]);
  });

  it("answers the breakout values with the column, and an empty column map as it comes", async () => {
    const { mb } = clientOver([
      jsonResponse(BREAKOUT_VALUES),
      jsonResponse({ values: [], col: {} }),
    ]);

    expect(await mb.metric.breakoutValues(AVERAGE_ORDER)).toEqual(BREAKOUT_VALUES);
    expect(await mb.metric.breakoutValues(AVERAGE_ORDER)).toEqual({ values: [], col: {} });
  });

  it("sends the dimension listing request with every filter", async () => {
    const { mb, capture } = clientOver([jsonResponse(LISTING)]);

    await mb.metric.dimensions(42, {
      query: "creat",
      "with-addable": true,
      "include-orphaned": false,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/metric/42/dimension?query=creat&with-addable=true&include-orphaned=false",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits an unset listing parameter from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse(LISTING)]);

    await mb.metric.dimensions(42);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/metric/42/dimension",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers the added and addable dimensions", async () => {
    const { mb } = clientOver([jsonResponse(LISTING)]);

    expect(await mb.metric.dimensions(42)).toEqual(LISTING);
  });

  it("refuses a dimension whose status is outside the closed set", async () => {
    const { mb } = clientOver([
      jsonResponse({ added: [{ ...CREATED_AT, status: "active" }], addable: [] }),
    ]);

    const error = await thrownBy(() => mb.metric.dimensions(42));

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.message).toContain(
      'added[0].status: Invalid option: expected one of "status/active"|"status/orphaned"',
    );
  });

  it("refuses the dimension listing before the wire on a server older than the route", async () => {
    const { mb, capture } = clientOver([], SERVER_63);

    const error = await thrownBy(() => mb.metric.dimensions(42));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v64+ (this server is v0.63.0). Upgrade Metabase to use it.",
      feature: "metricDimensionListing",
      since: 64,
      tokenFeature: null,
      serverVersion: "v0.63.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("refuses a definition query before the wire on a server without the metric routes", async () => {
    const { mb, capture } = clientOver([], SERVER_59);

    const error = await thrownBy(() => mb.metric.query(AVERAGE_ORDER));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v60+ (this server is v0.59.0). Upgrade Metabase to use it.",
      feature: "metricDefinitionQuery",
      since: 60,
      tokenFeature: null,
      serverVersion: "v0.59.0",
    });
    expect(capture.calls).toEqual([]);
  });
});

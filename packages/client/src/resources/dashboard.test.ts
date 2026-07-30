import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import { NetworkError } from "../errors";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import { createFakeClient } from "../testing/fake-client";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

import { dashboardResource } from "./dashboard";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

function card(id: number, archived = false) {
  return {
    id,
    name: `card-${id}`,
    type: "question",
    display: "table",
    description: null,
    archived,
    query_type: "query",
    database_id: 1,
    table_id: null,
    collection_id: null,
    entity_id: null,
    creator_id: 1,
    dataset_query: { type: "query" },
    visualization_settings: {},
  };
}

function cardRequest(id: number) {
  return {
    url: `https://mb.example.com/metabase/api/card/${id}`,
    method: "GET",
    headers: JSON_READ_HEADERS,
    body: null,
  };
}

const DASHCARD = {
  id: 11,
  dashboard_id: 5,
  card_id: 7,
  dashboard_tab_id: null,
  row: 0,
  col: 0,
  size_x: 12,
  size_y: 6,
  entity_id: "ccccccccccccccccccccc",
  visualization_settings: {},
  parameter_mappings: [],
  inline_parameters: [],
};

const DASHBOARD = {
  id: 5,
  name: "Orders Overview",
  description: null,
  archived: false,
  collection_id: 3,
  creator_id: 1,
  entity_id: "aaaaaaaaaaaaaaaaaaaaa",
  width: "fixed",
  auto_apply_filters: true,
  enable_embedding: false,
  public_uuid: null,
  cache_ttl: null,
  parameters: [],
};

const DASHBOARD_DETAIL = {
  ...DASHBOARD,
  dashcards: [DASHCARD],
  tabs: [],
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

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("dashboard resource wire requests", () => {
  it("sends the list request with the filter preset", async () => {
    const { mb, capture } = clientOver([jsonResponse([DASHBOARD])]);

    await mb.dashboard.list({ f: "archived" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard?f=archived",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits an unset filter preset from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([DASHBOARD])]);

    await mb.dashboard.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(DASHBOARD_DETAIL)]);

    await mb.dashboard.get(5);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard/5",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(DASHBOARD)]);

    await mb.dashboard.create({ name: "Orders Overview", collection_id: 3 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Orders Overview","collection_id":3}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(DASHBOARD_DETAIL)]);

    await mb.dashboard.update(5, { name: "Renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard/5",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...DASHBOARD, archived: true })]);

    await mb.dashboard.archive(5);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard/5",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });

  it("reads the dashboard, then replaces every dashcard with the patched one merged in", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(DASHBOARD_DETAIL),
      jsonResponse({ ...DASHBOARD_DETAIL, dashcards: [{ ...DASHCARD, row: 4, col: 2 }] }),
    ]);

    await mb.dashboard.updateDashcard(5, 11, { row: 4, col: 2 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard/5",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/dashboard/5",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"dashcards":[{"dashboard_id":5,"card_id":7,"dashboard_tab_id":null,"visualization_settings":{},"parameter_mappings":[],"inline_parameters":[],"id":11,"size_x":12,"size_y":6,"row":4,"col":2}]}',
      },
    ]);
  });

  it("sends the parameter values request with the parameter id escaped into the path", async () => {
    const { mb, capture } = clientOver([jsonResponse({ values: [], has_more_values: false })]);

    await mb.dashboard.parameterValues(5, "order status");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard/5/params/order%20status/values",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the parameter value search with both the parameter id and the query escaped", async () => {
    const { mb, capture } = clientOver([jsonResponse({ values: [], has_more_values: false })]);

    await mb.dashboard.searchParameterValues(5, "order status", "Cam/2");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/dashboard/5/params/order%20status/search/Cam%2F2",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

describe("dashboard card-reference check", () => {
  it("sends no request when the body carries no dashcards", async () => {
    const { mb, capture } = clientOver([]);

    await mb.dashboard.checkCardReferences(undefined);

    expect(capture.calls).toEqual([]);
  });

  it("sends no request for null, zero, negative and absent card ids", async () => {
    const { mb, capture } = clientOver([]);

    await mb.dashboard.checkCardReferences([
      { id: -1, card_id: null },
      { id: -2, card_id: -5 },
      { id: -3, card_id: 0 },
      { id: -4 },
    ]);

    expect(capture.calls).toEqual([]);
  });

  it("reads each distinct card once, in the order the dashcards first reference it", async () => {
    const { mb, capture } = clientOver([jsonResponse(card(42)), jsonResponse(card(17))]);

    await mb.dashboard.checkCardReferences([
      { id: -1, card_id: 42 },
      { id: -2, card_id: 17 },
      { id: -3, card_id: 42 },
    ]);

    expect(capture.calls).toEqual([cardRequest(42), cardRequest(17)]);
  });

  it("reports no issue when every referenced card exists and is live", async () => {
    const { mb } = clientOver([jsonResponse(card(42))]);

    const issues = await mb.dashboard.checkCardReferences([{ id: -1, card_id: 42 }]);

    expect(issues).toEqual([]);
  });

  it("reports one issue per reference when several dashcards share an archived card", async () => {
    const { mb } = clientOver([jsonResponse(card(134, true))]);

    const issues = await mb.dashboard.checkCardReferences([
      { id: -1, card_id: 134 },
      { id: -2, card_id: 134 },
    ]);

    expect(issues).toEqual([
      { cardId: 134, path: "/dashcards/0/card_id", problem: { reason: "archived" } },
      { cardId: 134, path: "/dashcards/1/card_id", problem: { reason: "archived" } },
    ]);
  });

  it("keeps each reference's own index in its path across entries it cannot read", async () => {
    const { mb } = clientOver([jsonResponse(card(99, true)), jsonResponse(card(7, true))]);

    const issues = await mb.dashboard.checkCardReferences([
      { id: -1, card_id: 99 },
      "not an object",
      42,
      null,
      { id: -2, card_id: "not a number" },
      { id: -3, card_id: 7 },
    ]);

    expect(issues).toEqual([
      { cardId: 99, path: "/dashcards/0/card_id", problem: { reason: "archived" } },
      { cardId: 7, path: "/dashcards/5/card_id", problem: { reason: "archived" } },
    ]);
  });

  it("reports a card the server has no row for as missing", async () => {
    const { mb } = clientOver([jsonResponse({ message: "Not found." }, 404)]);

    const issues = await mb.dashboard.checkCardReferences([{ id: -1, card_id: 9999 }]);

    expect(issues).toEqual([
      { cardId: 9999, path: "/dashcards/0/card_id", problem: { reason: "missing" } },
    ]);
  });

  it("reports a card the caller may not read as unreadable, carrying the server's message", async () => {
    const { mb } = clientOver([
      jsonResponse({ message: "You do not have permissions to do that." }, 403),
    ]);

    const issues = await mb.dashboard.checkCardReferences([{ id: -1, card_id: 55 }]);

    expect(issues).toEqual([
      {
        cardId: 55,
        path: "/dashcards/0/card_id",
        problem: {
          reason: "unreadable",
          detail: "You do not have permissions to do that.",
        },
      },
    ]);
  });

  it("propagates a 404 that says the card route itself is absent", async () => {
    const { mb } = clientOver([jsonResponse({ message: "API endpoint does not exist." }, 404)]);

    const failure = mb.dashboard.checkCardReferences([{ id: -1, card_id: 42 }]);

    await expect(failure).rejects.toBeInstanceOf(HttpError);
    await expect(failure).rejects.toThrow(
      "This endpoint is not available on the connected Metabase: GET /metabase/api/card/42.",
    );
  });

  it("propagates a non-HTTP failure untouched", async () => {
    const network = new NetworkError("Could not reach Metabase: connect ECONNREFUSED", {
      method: "GET",
      url: "https://mb.example.com/metabase/api/card/1",
      cause: "connect ECONNREFUSED",
    });
    const { client } = createFakeClient({
      routes: [{ path: "/api/card/1", reply: { kind: "error", error: network } }],
    });

    const failure = dashboardResource(client).checkCardReferences([{ id: -1, card_id: 1 }]);

    await expect(failure).rejects.toBe(network);
  });
});

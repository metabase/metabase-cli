import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import type { Page } from "../paginate";
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

const CARD_NODE = {
  id: 7,
  type: "card",
  data: {
    name: "Orders by month",
    type: "question",
    display: "line",
    database_id: 1,
    view_count: 12,
    collection_id: null,
    collection: { id: "root", name: "Our analytics", authority_level: null, is_personal: false },
    dashboard_id: null,
    dashboard: null,
    document_id: null,
    document: null,
  },
  dependents_count: null,
};

const TABLE_NODE = {
  id: 3,
  type: "table",
  data: { name: "ORDERS", display_name: "Orders", description: null, db_id: 1, schema: "PUBLIC" },
  dependents_count: { question: 2, model: 1 },
};

const BROKEN_CARD = { id: CARD_NODE.id, type: CARD_NODE.type, data: CARD_NODE.data };

const GRAPH = {
  nodes: [CARD_NODE, TABLE_NODE],
  edges: [
    { from_entity_type: "card", from_entity_id: 7, to_entity_type: "table", to_entity_id: 3 },
  ],
};

const BREAKING_TABLE = {
  ...TABLE_NODE,
  dependents_errors: [
    {
      id: 41,
      analyzed_entity_type: "card",
      analyzed_entity_id: 7,
      error_type: "missing-column",
      error_detail: "TOTAL",
      source_entity_type: "table",
      source_entity_id: 3,
    },
  ],
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: false },
});

const V58_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.58.0", major: 58, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { dependencies: true },
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

async function collectPages<T>(pages: AsyncIterable<Page<T>>): Promise<Page<T>[]> {
  const collected: Page<T>[] = [];
  for await (const page of pages) {
    collected.push(page);
  }
  return collected;
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("dependency resource wire requests", () => {
  it("sends the graph request with the entity in the query", async () => {
    const { mb, capture } = clientOver([jsonResponse(GRAPH)]);

    await mb.dependency.graph("card", 7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/dependencies/graph?type=card&id=7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the dependents request with every filter, repeating the key of each array", async () => {
    const { mb, capture } = clientOver([jsonResponse([CARD_NODE])]);

    await mb.dependency.dependents("table", 3, {
      "dependent-types": ["card", "dashboard"],
      "dependent-card-types": ["question"],
      broken: true,
      query: "orders",
      "include-personal-collections": false,
      "sort-column": "view-count",
      "sort-direction": "desc",
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/dependencies/graph/dependents?type=table&id=3&dependent-types=card&dependent-types=dashboard&dependent-card-types=question&broken=true&query=orders&include-personal-collections=false&sort-column=view-count&sort-direction=desc",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the dependents listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([CARD_NODE])]);

    expect(await mb.dependency.dependents("table", 3)).toEqual({ data: [CARD_NODE], total: null });
  });

  it("sends the broken request with the entity and its filters in the query", async () => {
    const { mb, capture } = clientOver([jsonResponse([BROKEN_CARD])]);

    await mb.dependency.broken("table", 3, {
      "dependent-types": ["card"],
      "dependent-card-types": ["question", "model"],
      "include-personal-collections": true,
      "sort-column": "location",
      "sort-direction": "asc",
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/dependencies/graph/broken?type=table&id=3&dependent-types=card&dependent-card-types=question&dependent-card-types=model&include-personal-collections=true&sort-column=location&sort-direction=asc",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the broken listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([BROKEN_CARD])]);

    expect(await mb.dependency.broken("table", 3)).toEqual({ data: [BROKEN_CARD], total: null });
  });

  it("sends the unreferenced request with the filters plus the paging window", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [CARD_NODE], total: 12 })]);

    const pages = mb.dependency.unreferencedPages(
      { types: ["card", "table"], "card-types": ["model"], "sort-column": "name" },
      { offset: 10, max: 2, pageSize: 2 },
    );
    await pages[Symbol.asyncIterator]().next();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/dependencies/graph/unreferenced?types=card&types=table&card-types=model&sort-column=name&limit=2&offset=10",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("yields the unreferenced rows with the server's count on each page", async () => {
    const { mb } = clientOver([jsonResponse({ data: [CARD_NODE, TABLE_NODE], total: 2 })]);

    expect(await collectPages(mb.dependency.unreferencedPages())).toEqual([
      { items: [CARD_NODE, TABLE_NODE], total: 2 },
    ]);
  });

  it("sends the breaking request with the filters plus the paging window", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [BREAKING_TABLE], total: 1 })]);

    const pages = mb.dependency.breakingPages(
      {
        types: ["table"],
        query: "orders",
        "include-personal-collections": true,
        "sort-column": "dependents-errors",
        "sort-direction": "desc",
      },
      { pageSize: 5 },
    );
    await pages[Symbol.asyncIterator]().next();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/dependencies/graph/breaking?types=table&query=orders&include-personal-collections=true&sort-column=dependents-errors&sort-direction=desc&limit=5&offset=0",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("yields the breaking sources with their downstream errors and the server's count", async () => {
    const { mb } = clientOver([jsonResponse({ data: [BREAKING_TABLE], total: 1 })]);

    expect(await collectPages(mb.dependency.breakingPages())).toEqual([
      { items: [BREAKING_TABLE], total: 1 },
    ]);
  });

  it("refuses a server without the token feature before any request leaves", async () => {
    const { mb, capture } = clientOver([], UNLICENSED_SERVER);

    const error = await thrownBy(() => mb.dependency.graph("card", 7));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.userMessage).toBe(
      "This operation requires the 'dependencies' premium feature (not enabled on this server).",
    );
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'dependencies' premium feature (not enabled on this server).",
      feature: "dependencyGraph",
      since: 58,
      tokenFeature: "dependencies",
      serverVersion: "v1.64.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("refuses the item listings on a licensed server below their floor, naming the feature", async () => {
    const { mb, capture } = clientOver([], V58_SERVER);

    const error = await thrownBy(() => mb.dependency.dependents("table", 3));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.userMessage).toBe(
      "This operation requires Metabase v59+ (this server is v1.58.0). Upgrade Metabase to use it.",
    );
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v59+ (this server is v1.58.0). Upgrade Metabase to use it.",
      feature: "dependencyItemListings",
      since: 59,
      tokenFeature: "dependencies",
      serverVersion: "v1.58.0",
    });
    expect(capture.calls).toEqual([]);
  });
});

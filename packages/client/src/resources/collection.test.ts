import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const COLLECTION = {
  id: 4,
  name: "Ops",
  description: null,
  archived: false,
  location: "/",
  parent_id: null,
  entity_id: "voo1If9y8Sld0lXej6xl0",
};

const COLLECTION_ITEM = {
  id: 12,
  model: "card",
  name: "Orders",
  archived: false,
  collection_id: 4,
};

// A `type` the server sends and the domain schema does not enumerate.
const UNPINNED_TYPE_COLLECTION = { id: 51, name: "Workspace", type: "workspace" };

const TREE_NODE = {
  id: 4,
  name: "Ops",
  location: "/",
  children: [],
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

describe("collection resource wire requests", () => {
  it("sends the unfiltered list request with no query parameters", async () => {
    const { mb, capture } = clientOver([jsonResponse([COLLECTION])]);

    await mb.collection.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the archived filter preset as the archived parameter", async () => {
    const { mb, capture } = clientOver([jsonResponse([COLLECTION])]);

    await mb.collection.list({ filter: "archived" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection?archived=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the personal filter preset as the personal-only parameter", async () => {
    const { mb, capture } = clientOver([jsonResponse([COLLECTION])]);

    await mb.collection.list({ filter: "personal" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection?personal-only=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the library-inclusive listing as the include-library parameter", async () => {
    const { mb, capture } = clientOver([jsonResponse([COLLECTION])]);

    await mb.collection.listWithLibrary();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection?include-library=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the get request for a numeric id", async () => {
    const { mb, capture } = clientOver([jsonResponse(COLLECTION)]);

    await mb.collection.get(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection/4",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the get request for the root alias", async () => {
    const { mb, capture } = clientOver([jsonResponse({ id: "root", name: "Our analytics" })]);

    await mb.collection.get("root");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection/root",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("percent-encodes a string ref instead of letting it reshape the path", async () => {
    const { mb, capture } = clientOver([jsonResponse(COLLECTION)]);

    await mb.collection.get("a/b?c d");

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection/a%2Fb%3Fc%20d",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(COLLECTION)]);

    await mb.collection.create({ name: "Ops", parent_id: 2 });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Ops","parent_id":2}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(COLLECTION)]);

    await mb.collection.update(4, { name: "Renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Renamed"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...COLLECTION, archived: true })]);

    await mb.collection.archive(4);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection/4",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });

  it("sends the items request with every filter plus the paging window", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ data: [COLLECTION_ITEM, { ...COLLECTION_ITEM, id: 13 }], total: 12 }),
    ]);

    const pages = mb.collection.itemPages(
      "root",
      { models: ["card", "dashboard"], archived: true, pinned_state: "is_pinned" },
      { offset: 10, max: 2, pageSize: 2 },
    );
    await pages[Symbol.asyncIterator]().next();

    expect(capture.calls).toEqual([
      {
        url:
          "https://mb.example.com/metabase/api/collection/root/items" +
          "?models=card&models=dashboard&archived=true&pinned_state=is_pinned&limit=2&offset=10",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the tree request", async () => {
    const { mb, capture } = clientOver([jsonResponse([TREE_NODE])]);

    await mb.collection.tree();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection/tree",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });
});

describe("collection resource results", () => {
  it("parses the library-inclusive listing through the full collection schema", async () => {
    const { mb } = clientOver([jsonResponse([COLLECTION, UNPINNED_TYPE_COLLECTION])]);

    const error = await mb.collection.listWithLibrary().catch((caught: unknown) => caught);

    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "Metabase returned unexpected response shape:\n" +
        '  [1].type: Invalid option: expected one of "instance-analytics"|"trash"|"library"|' +
        '"library-data"|"library-metrics"|"tenant-specific-root-collection"',
    );
  });
});

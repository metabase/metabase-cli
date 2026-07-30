import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

// Released servers (v0.59-v0.61) omit `type` and `is_remote_synced` from each `effective_children`
// entry; the collection listing is where both come from.
const UNHYDRATED_LIBRARY = {
  id: 10,
  name: "Library",
  type: "library",
  description: null,
  location: "/",
  effective_children: [
    { id: 11, name: "Data", description: null },
    { id: 12, name: "Metrics", description: null },
  ],
};

const LIBRARY_COLLECTIONS = [
  { id: 10, name: "Library", type: "library", location: "/", is_remote_synced: false },
  { id: 11, name: "Data", type: "library-data", location: "/10/", is_remote_synced: false },
  { id: 12, name: "Metrics", type: "library-metrics", location: "/10/", is_remote_synced: true },
];

const HYDRATED_LIBRARY = {
  ...UNHYDRATED_LIBRARY,
  effective_children: [
    { id: 11, name: "Data", description: null, type: "library-data", is_remote_synced: false },
    {
      id: 12,
      name: "Metrics",
      description: null,
      type: "library-metrics",
      is_remote_synced: true,
    },
  ],
};

// A collection unrelated to the Library, carrying values the domain schema does not enumerate.
const UNPINNED_ENUM_COLLECTION = {
  id: 51,
  name: "Workspace",
  location: "/",
  namespace: "workspaces",
  authority_level: "critical",
};

const ABSENT_LIBRARY = { data: null };

const TARGET_COLLECTION = {
  id: 11,
  name: "Data",
  type: "library-data",
  description: null,
  location: "/10/",
  is_remote_synced: false,
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_WRITE_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const ROOT_URL = "https://mb.example.com/metabase/api/ee/library/";
const COLLECTIONS_URL = "https://mb.example.com/metabase/api/collection?include-library=true";

const READ_ROOT_CALL = { url: ROOT_URL, method: "GET", headers: JSON_READ_HEADERS, body: null };
const READ_COLLECTIONS_CALL = {
  url: COLLECTIONS_URL,
  method: "GET",
  headers: JSON_READ_HEADERS,
  body: null,
};

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("library resource wire requests", () => {
  it("sends the get request and the collection listing that resolves its children", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await mb.library.get();

    expect(capture.calls).toEqual([READ_ROOT_CALL, READ_COLLECTIONS_CALL]);
  });

  it("sends the bodyless create POST and refetches when no Library exists", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(ABSENT_LIBRARY),
      jsonResponse({ id: 10, name: "Library" }),
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await mb.library.create();

    expect(capture.calls).toEqual([
      READ_ROOT_CALL,
      { url: ROOT_URL, method: "POST", headers: JSON_READ_HEADERS, body: null },
      READ_ROOT_CALL,
      READ_COLLECTIONS_CALL,
    ]);
  });

  it("repeats only the reads and never POSTs when create runs twice against an existing Library", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await mb.library.create();
    await mb.library.create();

    expect(capture.calls).toEqual([
      READ_ROOT_CALL,
      READ_COLLECTIONS_CALL,
      READ_ROOT_CALL,
      READ_COLLECTIONS_CALL,
    ]);
  });

  it("resolves the Data collection id from the create reads alone", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await mb.library.ensureDataCollectionId();

    expect(capture.calls).toEqual([READ_ROOT_CALL, READ_COLLECTIONS_CALL]);
  });

  it("sends the publish request with the target collection and the selectors", async () => {
    const { mb, capture } = clientOver([jsonResponse({ target_collection: TARGET_COLLECTION })]);

    await mb.library.publishTables({ collection_id: 11, table_ids: [3, 4], schema_ids: ["1:pub"] });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/data-studio/table/publish-tables",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"collection_id":11,"table_ids":[3,4],"schema_ids":["1:pub"]}',
      },
    ]);
  });

  it("sends the unpublish request accepting a non-JSON answer", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.library.unpublishTables({ database_ids: [7] });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/data-studio/table/unpublish-tables",
        method: "POST",
        headers: BINARY_WRITE_HEADERS,
        body: '{"database_ids":[7]}',
      },
    ]);
  });
});

describe("library resource results", () => {
  it("resolves each child's type and sync flag from the collection listing", async () => {
    const { mb } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    expect(await mb.library.get()).toEqual(HYDRATED_LIBRARY);
  });

  it("resolves the children past a collection whose enum fields carry unpinned values", async () => {
    const { mb } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse([...LIBRARY_COLLECTIONS, UNPINNED_ENUM_COLLECTION]),
    ]);

    expect(await mb.library.get()).toEqual(HYDRATED_LIBRARY);
  });

  it("keeps a hydrated response's own values when the listing holds no matching collection", async () => {
    const { mb } = clientOver([jsonResponse(HYDRATED_LIBRARY), jsonResponse([])]);

    expect(await mb.library.get()).toEqual(HYDRATED_LIBRARY);
  });

  it("answers null on an instance that has no Library", async () => {
    const { mb } = clientOver([jsonResponse(ABSENT_LIBRARY)]);

    expect(await mb.library.get()).toBeNull();
  });

  it("returns the existing Library rather than creating a second one", async () => {
    const { mb } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    expect(await mb.library.create()).toEqual(HYDRATED_LIBRARY);
  });

  it("throws when the refetch after the create POST still finds no Library", async () => {
    const { mb } = clientOver([
      jsonResponse(ABSENT_LIBRARY),
      jsonResponse({ id: 10, name: "Library" }),
      jsonResponse(ABSENT_LIBRARY),
    ]);

    await expect(mb.library.create()).rejects.toThrow(
      new Error("Library was not created after POST /api/ee/library/"),
    );
  });

  it("returns the Data collection's id", async () => {
    const { mb } = clientOver([
      jsonResponse(UNHYDRATED_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    expect(await mb.library.ensureDataCollectionId()).toBe(11);
  });

  it("throws when the Library carries no Data collection", async () => {
    const { mb } = clientOver([
      jsonResponse({ ...UNHYDRATED_LIBRARY, effective_children: [] }),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await expect(mb.library.ensureDataCollectionId()).rejects.toThrow(
      new Error("Library has no Data collection to publish into"),
    );
  });

  it("throws when the Data collection's id is not numeric", async () => {
    const { mb } = clientOver([
      jsonResponse({
        ...UNHYDRATED_LIBRARY,
        effective_children: [{ id: "NuFrFzRZgvqcMGjSjOOJH", name: "Data", type: "library-data" }],
      }),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await expect(mb.library.ensureDataCollectionId()).rejects.toThrow(
      new Error("Library Data collection has a non-numeric id NuFrFzRZgvqcMGjSjOOJH"),
    );
  });

  it("returns the collection the publish landed in", async () => {
    const { mb } = clientOver([jsonResponse({ target_collection: TARGET_COLLECTION })]);

    expect(await mb.library.publishTables({ collection_id: 11, table_ids: [3] })).toEqual(
      TARGET_COLLECTION,
    );
  });
});

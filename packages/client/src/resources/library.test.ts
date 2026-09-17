import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const LIBRARY_ROOT = { id: 10, name: "Library", type: "library", description: null, location: "/" };

const BARE_LIBRARY = {
  ...LIBRARY_ROOT,
  effective_children: [
    { id: 11, name: "Data", description: null },
    { id: 12, name: "Metrics", description: null },
  ],
};

const TYPED_LIBRARY = {
  ...LIBRARY_ROOT,
  effective_children: [
    { id: 11, name: "Data", description: null, type: "library-data" },
    { id: 12, name: "Metrics", description: null, type: "library-metrics" },
  ],
};

const LIBRARY_COLLECTIONS = [
  { id: 10, name: "Library", type: "library", location: "/", is_remote_synced: false },
  { id: 11, name: "Data", type: "library-data", location: "/10/", is_remote_synced: false },
  { id: 12, name: "Metrics", type: "library-metrics", location: "/10/", is_remote_synced: true },
];

const LIBRARY = {
  ...LIBRARY_ROOT,
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

const MISSING_TYPE_ISSUE =
  'Invalid option: expected one of "instance-analytics"|"trash"|"library"|"library-data"|"library-metrics"|"tenant-specific-root-collection"';

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

// The least server that answers this resource, so a method asking for more than the resource's
// own feature is refused here before it reaches the scripted wire.
const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { library: true },
});

// The first generation whose `effective_children` carry each child's `type`.
const TYPED_CHILDREN_SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.62.0", major: 62, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { library: true },
});

function clientOver(responses: Array<Response>, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("library resource wire requests", () => {
  it("sends the get request and the collection listing that resolves its children", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(BARE_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await mb.library.get();

    expect(capture.calls).toEqual([READ_ROOT_CALL, READ_COLLECTIONS_CALL]);
  });

  it("still reads the collection listing when the children carry a type, for the sync flag", async () => {
    const { mb, capture } = clientOver(
      [jsonResponse(TYPED_LIBRARY), jsonResponse(LIBRARY_COLLECTIONS)],
      TYPED_CHILDREN_SERVER,
    );

    await mb.library.get();

    expect(capture.calls).toEqual([READ_ROOT_CALL, READ_COLLECTIONS_CALL]);
  });

  it("sends the bodyless create POST and refetches when no Library exists", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(ABSENT_LIBRARY),
      jsonResponse({ id: 10, name: "Library" }),
      jsonResponse(BARE_LIBRARY),
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
      jsonResponse(BARE_LIBRARY),
      jsonResponse(LIBRARY_COLLECTIONS),
      jsonResponse(BARE_LIBRARY),
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
      jsonResponse(BARE_LIBRARY),
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
    const { mb } = clientOver([jsonResponse(BARE_LIBRARY), jsonResponse(LIBRARY_COLLECTIONS)]);

    expect(await mb.library.get()).toEqual(LIBRARY);
  });

  it("resolves the children past a collection whose enum fields carry unpinned values", async () => {
    const { mb } = clientOver([
      jsonResponse(BARE_LIBRARY),
      jsonResponse([...LIBRARY_COLLECTIONS, UNPINNED_ENUM_COLLECTION]),
    ]);

    expect(await mb.library.get()).toEqual(LIBRARY);
  });

  it("resolves typed children with only the sync flag taken from the listing", async () => {
    const { mb } = clientOver(
      [jsonResponse(TYPED_LIBRARY), jsonResponse(LIBRARY_COLLECTIONS)],
      TYPED_CHILDREN_SERVER,
    );

    expect(await mb.library.get()).toEqual(LIBRARY);
  });

  it("reads null for a child the listing does not describe", async () => {
    const { mb } = clientOver([jsonResponse(BARE_LIBRARY), jsonResponse([])]);

    expect(await mb.library.get()).toEqual({
      ...LIBRARY_ROOT,
      effective_children: [
        { id: 11, name: "Data", description: null, type: null, is_remote_synced: null },
        { id: 12, name: "Metrics", description: null, type: null, is_remote_synced: null },
      ],
    });
  });

  it("refuses children without a type from a server whose children carry one", async () => {
    const { mb } = clientOver([jsonResponse(BARE_LIBRARY)], TYPED_CHILDREN_SERVER);

    const error = await mb.library.get().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v1.62.0 the response shape was unexpected:\n" +
        `  effective_children[0].type: ${MISSING_TYPE_ISSUE}\n` +
        `  effective_children[1].type: ${MISSING_TYPE_ISSUE}`,
    );
  });

  it("answers null on an instance that has no Library", async () => {
    const { mb } = clientOver([jsonResponse(ABSENT_LIBRARY)]);

    expect(await mb.library.get()).toBeNull();
  });

  it("returns the existing Library rather than creating a second one", async () => {
    const { mb } = clientOver([jsonResponse(BARE_LIBRARY), jsonResponse(LIBRARY_COLLECTIONS)]);

    expect(await mb.library.create()).toEqual(LIBRARY);
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
    const { mb } = clientOver([jsonResponse(BARE_LIBRARY), jsonResponse(LIBRARY_COLLECTIONS)]);

    expect(await mb.library.ensureDataCollectionId()).toBe(11);
  });

  it("throws when the Library carries no Data collection", async () => {
    const { mb } = clientOver([
      jsonResponse({ ...BARE_LIBRARY, effective_children: [] }),
      jsonResponse(LIBRARY_COLLECTIONS),
    ]);

    await expect(mb.library.ensureDataCollectionId()).rejects.toThrow(
      new Error("Library has no Data collection to publish into"),
    );
  });

  it("throws when the Data collection's id is not numeric", async () => {
    const { mb } = clientOver(
      [
        jsonResponse({
          ...LIBRARY_ROOT,
          effective_children: [
            { id: "NuFrFzRZgvqcMGjSjOOJH", name: "Data", description: null, type: "library-data" },
          ],
        }),
        jsonResponse(LIBRARY_COLLECTIONS),
      ],
      TYPED_CHILDREN_SERVER,
    );

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

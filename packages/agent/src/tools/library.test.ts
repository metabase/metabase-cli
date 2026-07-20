import { expect, test } from "vitest";
import type { InstanceContext } from "../metabase/probe";
import { type Responder, toolDeps } from "./fake-client";
import { runLibraryTool } from "./library";
import { TeachingError } from "./teaching-error";

const EE_59: InstanceContext = {
  url: "https://mb.example.com",
  versionTag: "v1.59.0",
  majorVersion: 59,
  edition: "enterprise",
  tokenFeatures: ["library"],
  user: null,
};

const OSS_59: InstanceContext = { ...EE_59, versionTag: "v0.59.0", tokenFeatures: [] };

const DATA_COLLECTION = {
  id: 8,
  name: "Data",
  type: "library-data",
  description: null,
  archived: false,
};

const LIBRARY_ROOT = {
  id: 7,
  name: "Library",
  type: "library",
  description: null,
  archived: false,
  effective_children: [
    { id: 8, name: "Data", type: null, description: null },
    { id: 9, name: "Metrics", type: null, description: null },
  ],
};

// The Library root reports its children without a `type`; the collection list is where Data and
// Metrics become distinguishable, which is what the tool joins on.
const COLLECTIONS = [
  { id: 8, name: "Data", type: "library-data", description: null, archived: false },
  { id: 9, name: "Metrics", type: "library-metrics", description: null, archived: false },
];

const LIBRARY: Responder = (path) => {
  if (path === "/api/collection") {
    return COLLECTIONS;
  }
  if (path === "/api/ee/library/") {
    return LIBRARY_ROOT;
  }
  return { target_collection: DATA_COLLECTION };
};

test("get resolves each child's type, so Data and Metrics are told apart", async () => {
  const { deps, requests } = toolDeps(LIBRARY, "/tmp", EE_59);

  const result = await runLibraryTool(deps, { action: "get" });

  expect(requests.map((request) => request.path)).toEqual(["/api/ee/library/", "/api/collection"]);
  expect(result.details).toEqual({
    kind: "json",
    label: "library collection 7",
    value: {
      id: 7,
      name: "Library",
      type: "library",
      effective_children: [
        {
          id: 8,
          name: "Data",
          type: "library-data",
          description: null,
          is_remote_synced: undefined,
        },
        {
          id: 9,
          name: "Metrics",
          type: "library-metrics",
          description: null,
          is_remote_synced: undefined,
        },
      ],
    },
  });
});

test("publish resolves the Data collection itself and names the cascade in its answer", async () => {
  const { deps, requests } = toolDeps(LIBRARY, "/tmp", EE_59);

  const result = await runLibraryTool(deps, { action: "publish", table_ids: [12, 15] });

  expect(requests.map((request) => request.path)).toEqual([
    "/api/ee/library/",
    "/api/collection",
    "/api/ee/data-studio/table/publish-tables",
  ]);
  expect(requests[2]?.options).toEqual({
    method: "POST",
    body: { collection_id: 8, table_ids: [12, 15] },
  });
  expect(result.details).toEqual({
    kind: "json",
    label: "published the selected tables, and their upstream sources, to Library collection 8",
    value: {
      target_collection: {
        id: 8,
        name: "Data",
        type: "library-data",
        description: null,
        archived: false,
      },
      table_ids: [12, 15],
    },
  });
});

test("an absent Library is created on the first publish", async () => {
  let created = false;
  const responder: Responder = (path, options) => {
    if (path === "/api/ee/library/" && options?.method === "POST") {
      created = true;
      return null;
    }
    if (path === "/api/ee/library/") {
      return created ? LIBRARY_ROOT : { data: null };
    }
    return LIBRARY(path, options);
  };
  const { deps, requests } = toolDeps(responder, "/tmp", EE_59);

  await runLibraryTool(deps, { action: "publish", table_ids: [12] });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/ee/library/",
    "POST /api/ee/library/",
    "GET /api/ee/library/",
    "GET /api/collection",
    "POST /api/ee/data-studio/table/publish-tables",
  ]);
});

test("unpublish posts the selectors and says the cascade runs downstream", async () => {
  const { deps, requests } = toolDeps(LIBRARY, "/tmp", EE_59);

  const result = await runLibraryTool(deps, { action: "unpublish", schema_ids: ["1:staging"] });

  expect(requests).toEqual([
    {
      path: "/api/ee/data-studio/table/unpublish-tables",
      method: "POST",
      options: {
        method: "POST",
        body: { schema_ids: ["1:staging"] },
        expectContentType: "binary",
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "unpublished the selected tables, and every table downstream of them, from the Library",
    value: { unpublished: true, schema_ids: ["1:staging"] },
  });
});

test("publishing nothing is a teaching error naming the three selectors", async () => {
  const { deps, requests } = toolDeps(LIBRARY, "/tmp", EE_59);

  await expect(runLibraryTool(deps, { action: "publish" })).rejects.toThrow(
    new TeachingError(
      "`publish` needs at least one selector: `table_ids`, `database_ids`, or `schema_ids`.",
    ),
  );
  expect(requests).toEqual([]);
});

test("an instance without the library feature refuses before any request leaves", async () => {
  const { deps, requests } = toolDeps(LIBRARY, "/tmp", OSS_59);

  await expect(runLibraryTool(deps, { action: "get" })).rejects.toThrow(
    new TeachingError(
      "`library` needs the `library` paid feature, which this instance does not have enabled. There is no workaround from this session.",
    ),
  );
  expect(requests).toEqual([]);
});

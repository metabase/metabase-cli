import { HttpError } from "@metabase/cli/errors";
import { expect, test } from "vitest";
import { runDuplicateContentTool } from "./duplicate-content";
import { type Responder, toolDeps } from "./fake-client";

function card(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 43,
    name: "Copy of Revenue",
    type: "question",
    display: "table",
    description: null,
    archived: false,
    query_type: "query",
    database_id: 1,
    table_id: 2,
    collection_id: 4,
    entity_id: "e",
    creator_id: 1,
    dataset_query: {},
    visualization_settings: {},
    ...overrides,
  };
}

function dashboardCopy(): Record<string, unknown> {
  return {
    id: 9,
    name: "Q3 Review - Duplicate",
    description: null,
    archived: false,
    collection_id: 7,
    creator_id: 1,
    entity_id: "e",
    width: "fixed",
    auto_apply_filters: true,
    enable_embedding: false,
    public_uuid: null,
    cache_ttl: null,
    parameters: [],
  };
}

test("copying a question renames and moves it in a follow-up write", async () => {
  const handler: Responder = (path) => {
    if (path === "/api/card/42/copy") {
      return card();
    }
    if (path === "/api/card/43") {
      return card({ name: "Revenue — draft", collection_id: 7 });
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps, requests } = toolDeps(handler);

  const result = await runDuplicateContentTool(deps, {
    type: "question",
    id: 42,
    new_name: "Revenue — draft",
    collection_id: 7,
  });

  expect(requests).toEqual([
    { path: "/api/card/42/copy", method: "POST", options: { method: "POST" } },
    {
      path: "/api/card/43",
      method: "PUT",
      options: {
        method: "PUT",
        body: { name: "Revenue — draft", collection_id: 7 },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "duplicated question 43",
    noun: "question",
    value: {
      id: 43,
      name: "Revenue — draft",
      type: "question",
      display: "table",
      archived: false,
      database_id: 1,
      collection_id: 7,
      description: null,
    },
  });
});

test("copying a question with no changes is a single call", async () => {
  const { deps, requests } = toolDeps(() => card());

  await runDuplicateContentTool(deps, { type: "question", id: 42 });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "POST /api/card/42/copy",
  ]);
});

test("is_deep_copy is a dashboard flag and is refused on a question", async () => {
  const { deps, requests } = toolDeps(() => card());

  await expect(
    runDuplicateContentTool(deps, { type: "question", id: 42, is_deep_copy: true }),
  ).rejects.toThrow(
    "`is_deep_copy` applies to dashboards — a question copy is always a new, independent card.",
  );
  expect(requests).toEqual([]);
});

test("copying a dashboard sends the name, collection, and deep-copy flag in one call", async () => {
  const { deps, requests } = toolDeps(() => dashboardCopy());

  const result = await runDuplicateContentTool(deps, {
    type: "dashboard",
    id: 3,
    collection_id: 7,
    is_deep_copy: true,
  });

  expect(requests).toEqual([
    {
      path: "/api/dashboard/3/copy",
      method: "POST",
      options: {
        method: "POST",
        body: { name: undefined, collection_id: 7, is_deep_copy: true },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "duplicated dashboard 9",
    noun: "dashboard",
    value: {
      id: 9,
      name: "Q3 Review - Duplicate",
      description: null,
      archived: false,
      collection_id: 7,
    },
  });
});

// The copy endpoint answers this refusal with a plain-text body, not the usual JSON envelope, so
// the sentence never reaches HttpError's message — hence the assertion on the whole teaching error.
test("a refused shallow copy names the flag that makes it work", async () => {
  const { deps } = toolDeps(() => {
    throw new HttpError({
      status: 400,
      statusText: "Bad Request",
      method: "POST",
      url: "http://localhost:3000/api/dashboard/3/copy",
      rawBody:
        "You cannot do a shallow copy of this dashboard because it contains Dashboard Questions.",
      responseHeaders: {},
    });
  });

  await expect(runDuplicateContentTool(deps, { type: "dashboard", id: 3 })).rejects.toThrow(
    "You cannot do a shallow copy of this dashboard because it contains Dashboard Questions. Pass `is_deep_copy: true` to copy those questions along with the dashboard.",
  );
});

test("a 400 that is not the shallow-copy refusal is passed through untouched", async () => {
  const { deps } = toolDeps(() => {
    throw new HttpError({
      status: 400,
      statusText: "Bad Request",
      method: "POST",
      url: "http://localhost:3000/api/dashboard/3/copy",
      rawBody: JSON.stringify({ message: "Collection does not exist." }),
      responseHeaders: {},
    });
  });

  await expect(runDuplicateContentTool(deps, { type: "dashboard", id: 3 })).rejects.toThrow(
    "Collection does not exist.",
  );
});

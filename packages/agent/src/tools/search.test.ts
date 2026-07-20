import { expect, test } from "vitest";
import { UNKNOWN_INSTANCE } from "../metabase/probe";
import type { MetabaseToolDeps } from "./deps";
import { fakeClient, type Responder } from "./fake-client";
import { runSearchTool } from "./search";
import { TeachingError } from "./teaching-error";

function makeDeps(handler: Responder): MetabaseToolDeps {
  const { client } = fakeClient(handler);
  return { client, cwd: "/tmp", instance: UNKNOWN_INSTANCE };
}

const notCalled: Responder = () => {
  throw new Error("client should not be called");
};

test("rejects an empty call with the three-mode teaching error", async () => {
  const deps = makeDeps(notCalled);
  await expect(runSearchTool(deps, {})).rejects.toBeInstanceOf(TeachingError);
  await expect(runSearchTool(deps, {})).rejects.toThrow(
    "Empty search. Pass one of: `query` (keyword search), a filter (`type`, `collection_id`, `created_by`, `archived`), or `recent: true` (recently viewed).",
  );
});

test("rejects recent combined with query", async () => {
  const deps = makeDeps(notCalled);
  await expect(runSearchTool(deps, { recent: true, query: "orders" })).rejects.toThrow(
    "`recent` cannot be combined with `query` — recents is a small activity feed, not a searchable index. Drop one.",
  );
});

test("rejects created_by against a creatorless type", async () => {
  const deps = makeDeps(notCalled);
  await expect(runSearchTool(deps, { created_by: "me", type: ["table", "card"] })).rejects.toThrow(
    "`created_by` does not apply to table — those types record no creator. Drop `created_by` or remove table from `type`.",
  );
});

test("translates the write-tool vocabulary into the search index's models", async () => {
  const handler: Responder = (path, options) => {
    expect(path).toBe("/api/search");
    expect(options?.query).toEqual({
      q: "revenue",
      models: ["card", "dataset", "metric"],
      collection: undefined,
      created_by: undefined,
      archived: undefined,
      limit: 20,
      offset: undefined,
    });
    return { total: 0, limit: 20, data: [] };
  };
  await runSearchTool(makeDeps(handler), {
    query: "revenue",
    type: ["question", "model", "metric"],
  });
});

test("rejects an unknown type by naming the accepted ones", async () => {
  const deps = makeDeps(notCalled);
  await expect(runSearchTool(deps, { query: "revenue", type: ["chart"] })).rejects.toThrow(
    'Unknown search type "chart". Pass one of: card, dataset, metric, dashboard, collection, database, table, segment, measure, document, action, transform, indexed-entity, question, model.',
  );
});

const recentsResponder: Responder = () => ({
  recents: [
    { id: 3, model: "dashboard", name: "KPIs", description: null },
    { id: 9, model: "card", name: "Revenue", description: null },
  ],
});

test("filters recents by the translated model name", async () => {
  const result = await runSearchTool(makeDeps(recentsResponder), {
    recent: true,
    type: ["question"],
  });
  expect(result.details).toEqual({
    kind: "list",
    noun: "recently viewed items",
    envelope: {
      data: [{ id: 9, model: "card", name: "Revenue", description: null }],
      returned: 1,
      total: 1,
    },
  });
});

test("projects search results to the concise envelope", async () => {
  const handler: Responder = (path) => {
    expect(path).toBe("/api/search");
    return {
      total: 1,
      limit: 20,
      data: [
        {
          id: 7,
          name: "Orders",
          model: "card",
          description: "All orders",
          archived: false,
          collection: { id: 4, name: "Sales", authority_level: null, type: null },
        },
      ],
    };
  };
  const result = await runSearchTool(makeDeps(handler), { query: "orders" });
  expect(result.details).toEqual({
    kind: "list",
    noun: "results",
    envelope: {
      data: [
        {
          id: 7,
          name: "Orders",
          model: "card",
          description: "All orders",
          collection: { id: 4, name: "Sales", authority_level: null, type: null },
        },
      ],
      returned: 1,
      total: 1,
    },
  });
});

test("serves recently viewed items when recent is set", async () => {
  const handler: Responder = (path, options) => {
    expect(path).toBe("/api/activity/recents");
    expect(options?.query).toEqual({ context: "views" });
    return {
      recents: [
        { id: 3, model: "dashboard", name: "KPIs", description: null },
        { id: 9, model: "card", name: "Revenue", description: null },
      ],
    };
  };
  const result = await runSearchTool(makeDeps(handler), { recent: true, type: ["dashboard"] });
  expect(result.details).toEqual({
    kind: "list",
    noun: "recently viewed items",
    envelope: {
      data: [{ id: 3, model: "dashboard", name: "KPIs", description: null }],
      returned: 1,
      total: 1,
    },
  });
});

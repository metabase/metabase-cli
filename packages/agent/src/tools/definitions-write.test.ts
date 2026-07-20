import { expect, test } from "vitest";
import { runMeasureWriteTool, runSegmentWriteTool, runSnippetWriteTool } from "./definitions-write";
import { type Responder, toolDeps } from "./fake-client";

const DEFINITION = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 9 }],
};

const SNIPPET: Responder = () => ({
  id: 3,
  name: "Active Rows",
  description: null,
  content: "deleted_at IS NULL",
  archived: false,
  collection_id: null,
  creator_id: 1,
  entity_id: "e",
  template_tags: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
});

const SEGMENT: Responder = () => ({
  id: 4,
  name: "Gadget orders",
  description: null,
  archived: false,
  table_id: 9,
  definition: DEFINITION,
  creator_id: 1,
  entity_id: "e",
  show_in_getting_started: null,
  caveats: null,
  points_of_interest: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
});

const MEASURE: Responder = () => ({
  id: 2,
  name: "Revenue",
  description: null,
  archived: false,
  table_id: 9,
  definition: DEFINITION,
  creator_id: 1,
  entity_id: "e",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
});

test("creating a snippet posts name and content", async () => {
  const { deps, requests } = toolDeps(SNIPPET);

  const result = await runSnippetWriteTool(deps, {
    method: "create",
    name: "Active Rows",
    content: "deleted_at IS NULL",
  });

  expect(requests).toEqual([
    {
      path: "/api/native-query-snippet",
      method: "POST",
      options: {
        method: "POST",
        body: { name: "Active Rows", content: "deleted_at IS NULL" },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created snippet 3",
    value: {
      id: 3,
      name: "Active Rows",
      description: null,
      archived: false,
      collection_id: null,
    },
  });
});

test("creating a snippet without content names the missing field", async () => {
  const { deps, requests } = toolDeps(SNIPPET);

  await expect(
    runSnippetWriteTool(deps, { method: "create", name: "Active Rows" }),
  ).rejects.toThrow("`content` is required for the `create` method.");
  expect(requests).toEqual([]);
});

test("archiving a snippet rides the update method", async () => {
  const { deps, requests } = toolDeps(SNIPPET);

  await runSnippetWriteTool(deps, { method: "update", id: 3, archived: true });

  expect(requests).toEqual([
    {
      path: "/api/native-query-snippet/3",
      method: "PUT",
      options: { method: "PUT", body: { archived: true } },
    },
  ]);
});

test("creating a segment posts the table and the filter definition", async () => {
  const { deps, requests } = toolDeps(SEGMENT);

  const result = await runSegmentWriteTool(deps, {
    method: "create",
    name: "Gadget orders",
    table_id: 9,
    definition: DEFINITION,
  });

  expect(requests).toEqual([
    {
      path: "/api/segment",
      method: "POST",
      options: {
        method: "POST",
        body: { name: "Gadget orders", table_id: 9, definition: DEFINITION },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created segment 4",
    noun: "segment",
    value: {
      id: 4,
      name: "Gadget orders",
      description: null,
      archived: false,
      table_id: 9,
    },
  });
});

test("a segment update without a revision message is refused before the API rejects it", async () => {
  const { deps, requests } = toolDeps(SEGMENT);

  await expect(runSegmentWriteTool(deps, { method: "update", id: 4, name: "x" })).rejects.toThrow(
    "`revision_message` is required for the `update` method.",
  );
  expect(requests).toEqual([]);
});

test("a segment update sends the revision message the API records", async () => {
  const { deps, requests } = toolDeps(SEGMENT);

  await runSegmentWriteTool(deps, {
    method: "update",
    id: 4,
    archived: true,
    revision_message: "Superseded by Widget orders",
  });

  expect(requests).toEqual([
    {
      path: "/api/segment/4",
      method: "PUT",
      options: {
        method: "PUT",
        body: { archived: true, revision_message: "Superseded by Widget orders" },
      },
    },
  ]);
});

test("creating a measure posts the table and the aggregation definition", async () => {
  const { deps, requests } = toolDeps(MEASURE);

  const result = await runMeasureWriteTool(deps, {
    method: "create",
    name: "Revenue",
    table_id: 9,
    definition: DEFINITION,
  });

  expect(requests).toEqual([
    {
      path: "/api/measure",
      method: "POST",
      options: {
        method: "POST",
        body: { name: "Revenue", table_id: 9, definition: DEFINITION },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created measure 2",
    value: {
      id: 2,
      name: "Revenue",
      description: null,
      archived: false,
      table_id: 9,
    },
  });
});

test("a measure update without a revision message is refused before the API rejects it", async () => {
  const { deps, requests } = toolDeps(MEASURE);

  await expect(
    runMeasureWriteTool(deps, { method: "update", id: 2, name: "Net revenue" }),
  ).rejects.toThrow("`revision_message` is required for the `update` method.");
  expect(requests).toEqual([]);
});

test("creating a measure without a table names the missing field", async () => {
  const { deps, requests } = toolDeps(MEASURE);

  await expect(
    runMeasureWriteTool(deps, { method: "create", name: "Revenue", definition: DEFINITION }),
  ).rejects.toThrow("`table_id` is required for the `create` method.");
  expect(requests).toEqual([]);
});

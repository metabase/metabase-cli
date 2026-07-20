import { expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { runGetContentTool } from "./get-content";

function card(id: number): Record<string, unknown> {
  return {
    id,
    name: "Revenue",
    type: "question",
    display: "table",
    description: "desc",
    archived: false,
    query_type: "query",
    database_id: 1,
    table_id: 2,
    collection_id: 4,
    entity_id: "e",
    creator_id: 1,
    dataset_query: { "lib/type": "mbql/query" },
    visualization_settings: {},
  };
}

test("rejects a batch over the cap", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  const items = Array.from({ length: 11 }, () => ({ type: "question" as const, id: 1 }));
  await expect(runGetContentTool(deps, { items })).rejects.toThrow(
    "Too many items (11); the cap is 10. Split into separate calls.",
  );
});

test("attaches include sections and names skipped ones per item", async () => {
  const handler: Responder = (path, options) => {
    if (path === "/api/card/5") {
      return card(5);
    }
    if (path === "/api/revision") {
      expect(options?.query).toEqual({ entity: "card", id: 5 });
      return [{ id: 7 }];
    }
    if (path === "/api/collection/3") {
      return { id: 3, name: "Sales" };
    }
    throw new Error(`unexpected ${path}`);
  };
  const { deps } = toolDeps(handler);
  const result = await runGetContentTool(deps, {
    items: [
      { type: "question", id: 5 },
      { type: "collection", id: 3 },
    ],
    include: ["definition", "revisions"],
  });
  expect(result.details).toEqual({
    kind: "json",
    label: "2 of 2 items",
    value: {
      data: [
        {
          id: 5,
          name: "Revenue",
          type: "question",
          display: "table",
          archived: false,
          database_id: 1,
          collection_id: 4,
          description: "desc",
          definition: { "lib/type": "mbql/query" },
          revisions: [{ id: 7 }],
        },
        {
          id: 3,
          name: "Sales",
          type: "collection",
          skipped_include: ["definition", "revisions"],
        },
      ],
      errors: [],
    },
  });
});

test("isolates a per-item fault", async () => {
  const handler: Responder = (path) => {
    if (path === "/api/card/5") {
      return card(5);
    }
    throw new Error("Not found.");
  };
  const { deps } = toolDeps(handler);
  const result = await runGetContentTool(deps, {
    items: [
      { type: "question", id: 5 },
      { type: "question", id: 404 },
    ],
  });
  expect(result.details).toEqual({
    kind: "json",
    label: "1 of 2 items",
    value: {
      data: [
        {
          id: 5,
          name: "Revenue",
          type: "question",
          display: "table",
          archived: false,
          database_id: 1,
          collection_id: 4,
          description: "desc",
        },
      ],
      errors: [{ type: "question", id: 404, error: "Not found." }],
    },
  });
});

import { expect, test } from "vitest";
import { runBrowseCollectionTool } from "./browse-collection";
import { type Responder, toolDeps } from "./fake-client";

test("rejects tree mode against the trash", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  await expect(runBrowseCollectionTool(deps, { id: "trash", mode: "tree" })).rejects.toThrow(
    '`tree` mode covers content collections only — call browse_collection with `id: "trash"` and the default `items` mode to see trashed content.',
  );
});

test("re-roots the tree and marks unexpanded subtrees at the depth boundary", async () => {
  const handler: Responder = (path) => {
    expect(path).toBe("/api/collection/tree");
    return [
      {
        id: 1,
        name: "A",
        children: [{ id: 2, name: "B", children: [{ id: 3, name: "C", children: [] }] }],
      },
    ];
  };
  const { deps } = toolDeps(handler);
  const result = await runBrowseCollectionTool(deps, { id: "root", mode: "tree", depth: 1 });
  expect(result.details).toEqual({
    kind: "json",
    label: "collection tree (1 roots)",
    value: {
      data: [
        {
          id: 1,
          name: "A",
          children: [
            {
              id: 2,
              name: "B",
              children: [],
              truncated:
                '1 nested collections — expand with browse_collection(id: 2, mode: "tree")',
            },
          ],
        },
      ],
    },
  });
});

test("lists items pinned-first in the concise envelope", async () => {
  const handler: Responder = (path) => {
    expect(path).toBe("/api/collection/4/items");
    return {
      total: 2,
      data: [
        {
          id: 10,
          model: "card",
          name: "Loose",
          description: null,
          archived: false,
          collection_id: 4,
          collection_position: null,
        },
        {
          id: 11,
          model: "dashboard",
          name: "Pinned",
          description: null,
          archived: false,
          collection_id: 4,
          collection_position: 1,
        },
      ],
    };
  };
  const { deps } = toolDeps(handler);
  const result = await runBrowseCollectionTool(deps, { id: 4 });
  expect(result.details).toEqual({
    kind: "list",
    noun: "items",
    envelope: {
      data: [
        {
          id: 11,
          model: "dashboard",
          name: "Pinned",
          description: null,
          archived: false,
          collection_id: 4,
        },
        {
          id: 10,
          model: "card",
          name: "Loose",
          description: null,
          archived: false,
          collection_id: 4,
        },
      ],
      returned: 2,
      total: 2,
    },
  });
});

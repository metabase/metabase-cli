import { expect, test } from "vitest";
import { runCollectionWriteTool } from "./collection-write";
import { type Responder, toolDeps } from "./fake-client";

const COLLECTION: Responder = () => ({
  id: 12,
  name: "Q3 Reporting",
  description: null,
  archived: false,
  location: "/4/",
  parent_id: 4,
  type: null,
  authority_level: null,
  is_personal: false,
  is_remote_synced: false,
});

test("create posts the collection and returns the compact record", async () => {
  const { deps, requests } = toolDeps(COLLECTION);

  const result = await runCollectionWriteTool(deps, {
    method: "create",
    name: "Q3 Reporting",
    parent_id: 4,
  });

  expect(requests).toEqual([
    {
      path: "/api/collection",
      method: "POST",
      options: { method: "POST", body: { name: "Q3 Reporting", parent_id: 4 } },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created collection 12",
    noun: "collection",
    value: {
      id: 12,
      name: "Q3 Reporting",
      description: null,
      archived: false,
      location: "/4/",
      parent_id: 4,
      type: null,
      authority_level: null,
      is_personal: false,
      is_remote_synced: false,
    },
  });
});

test("create without a name names the missing field", async () => {
  const { deps, requests } = toolDeps(COLLECTION);

  await expect(runCollectionWriteTool(deps, { method: "create" })).rejects.toThrow(
    "`name` is required for the `create` method.",
  );
  expect(requests).toEqual([]);
});

test("update without an id names the missing field", async () => {
  const { deps, requests } = toolDeps(COLLECTION);

  await expect(runCollectionWriteTool(deps, { method: "update", name: "x" })).rejects.toThrow(
    "`id` is required for the `update` method.",
  );
  expect(requests).toEqual([]);
});

test("archive and restore ride the update method", async () => {
  const { deps, requests } = toolDeps(COLLECTION);

  await runCollectionWriteTool(deps, { method: "update", id: 12, archived: true });
  await runCollectionWriteTool(deps, { method: "update", id: 12, archived: false });

  expect(requests).toEqual([
    {
      path: "/api/collection/12",
      method: "PUT",
      options: { method: "PUT", body: { archived: true } },
    },
    {
      path: "/api/collection/12",
      method: "PUT",
      options: { method: "PUT", body: { archived: false } },
    },
  ]);
});

test("a move is a parent_id on the update", async () => {
  const { deps, requests } = toolDeps(COLLECTION);

  await runCollectionWriteTool(deps, { method: "update", id: 12, parent_id: 7 });

  expect(requests[0]?.options?.body).toEqual({ parent_id: 7 });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { InstanceContext } from "../metabase/probe";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";
import { runTransformWriteTool } from "./transform-write";

const tempDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-tw-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const EE_59: InstanceContext = {
  url: "https://mb.example.com",
  versionTag: "v1.59.0",
  majorVersion: 59,
  edition: "enterprise",
  tokenFeatures: ["transforms"],
  user: null,
};

const OSS_58: InstanceContext = { ...EE_59, versionTag: "v0.58.0", majorVersion: 58 };

const SOURCE = {
  type: "query",
  query: {
    "lib/type": "mbql/query",
    database: 1,
    stages: [{ "lib/type": "mbql.stage/native", native: "SELECT 1" }],
  },
};

const TARGET = { type: "table", database: 1, schema: "public", name: "daily_orders" };

interface TransformFixture {
  id: number;
  name: string;
  description: string | null;
  source: unknown;
  target: typeof TARGET;
  source_type: string;
  target_db_id: number;
  target_table_id: number;
  entity_id: string;
  created_at: string;
  updated_at: string;
  creator_id: number;
  collection_id: number | null;
  tag_ids: number[];
}

function transformFixture(source: unknown = SOURCE): TransformFixture {
  return {
    id: 4,
    name: "Daily orders",
    description: null,
    source,
    target: TARGET,
    source_type: "native",
    target_db_id: 1,
    target_table_id: 12,
    entity_id: "e",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    creator_id: 1,
    collection_id: null,
    tag_ids: [7],
  };
}

const TRANSFORM: Responder = (path) => {
  if (path === "/api/transform-tag") {
    return [{ id: 7, name: "nightly", entity_id: "e", built_in_type: null }];
  }
  return transformFixture();
};

test("a native source is assembled into an MBQL 5 native stage and tags resolve to ids", async () => {
  const { deps, requests } = toolDeps(TRANSFORM, "/tmp", EE_59);

  const result = await runTransformWriteTool(deps, {
    method: "create",
    name: "Daily orders",
    native: { database_id: 1, sql: "SELECT 1" },
    target: TARGET,
    tags: ["nightly"],
  });

  expect(requests).toEqual([
    { path: "/api/transform-tag", method: "GET", options: undefined },
    {
      path: "/api/transform",
      method: "POST",
      options: {
        method: "POST",
        body: {
          name: "Daily orders",
          source: SOURCE,
          target: TARGET,
          tag_ids: [7],
        },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "created transform 4 — nothing has run yet; `transform_run` materializes it",
    noun: "transform",
    value: {
      id: 4,
      name: "Daily orders",
      description: null,
      source_type: "native",
      target_db_id: 1,
      target: TARGET,
    },
  });
});

test("a tag that does not exist yet is created, not rejected", async () => {
  const responder: Responder = (path, options) => {
    if (path === "/api/transform-tag" && options?.method === "POST") {
      return { id: 9, name: "hourly", entity_id: "e", built_in_type: null };
    }
    if (path === "/api/transform-tag") {
      return [];
    }
    return TRANSFORM(path, options);
  };
  const { deps, requests } = toolDeps(responder, "/tmp", EE_59);

  await runTransformWriteTool(deps, {
    method: "create",
    name: "Daily orders",
    source: SOURCE,
    target: TARGET,
    tags: ["hourly"],
  });

  expect(requests).toEqual([
    { path: "/api/transform-tag", method: "GET", options: undefined },
    {
      path: "/api/transform-tag",
      method: "POST",
      options: { method: "POST", body: { name: "hourly" } },
    },
    {
      path: "/api/transform",
      method: "POST",
      options: {
        method: "POST",
        body: { name: "Daily orders", source: SOURCE, target: TARGET, tag_ids: [9] },
      },
    },
  ]);
});

test("two sources at once is a teaching error naming all three", async () => {
  const { deps } = toolDeps(TRANSFORM, "/tmp", EE_59);

  await expect(
    runTransformWriteTool(deps, {
      method: "create",
      name: "Daily orders",
      source: SOURCE,
      native: { database_id: 1, sql: "SELECT 1" },
      target: TARGET,
    }),
  ).rejects.toThrow(
    new TeachingError("Provide exactly one source (source, source_file, native); received 2."),
  );
});

test("delete leaves the output table standing and names the flag that drops it", async () => {
  const { deps, requests } = toolDeps(TRANSFORM, "/tmp", EE_59);

  const result = await runTransformWriteTool(deps, { method: "delete", id: 4 });

  expect(requests).toEqual([
    {
      path: "/api/transform/4",
      method: "DELETE",
      options: { method: "DELETE", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label:
      "deleted transform 4 — its materialized output table still stands, and anything reading it keeps working. Pass `delete_target_table: true` to drop the table too.",
    value: { id: 4, deleted: true, target_table_dropped: false },
  });
});

test("delete_target_table drops the table before deleting the transform", async () => {
  const { deps, requests } = toolDeps(TRANSFORM, "/tmp", EE_59);

  const result = await runTransformWriteTool(deps, {
    method: "delete",
    id: 4,
    delete_target_table: true,
  });

  expect(requests).toEqual([
    {
      path: "/api/transform/4/table",
      method: "DELETE",
      options: { method: "DELETE", expectContentType: "binary" },
    },
    {
      path: "/api/transform/4",
      method: "DELETE",
      options: { method: "DELETE", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "deleted transform 4 and dropped its output table",
    value: { id: 4, deleted: true, target_table_dropped: true },
  });
});

function transformWith(source: unknown): Responder {
  return (path, options) =>
    path === "/api/transform-tag" ? TRANSFORM(path, options) : transformFixture(source);
}

test("pull writes a plain-SQL transform's SQL byte-exactly and names the way back", async () => {
  const cwd = await scratch();
  const { deps, requests } = toolDeps(TRANSFORM, cwd, EE_59);

  const result = await runTransformWriteTool(deps, { method: "pull", id: 4 });

  const file = join(cwd, "transform-4.sql");
  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/transform/4",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled transform 4 SQL to ${file}`,
    value: {
      file,
      database_id: 1,
      note: `Edit the file, then apply it with {method: "update", id: 4, native: {database_id: 1, sql_file: "${file}"}}.`,
    },
  });
  expect(await readFile(file, "utf8")).toBe("SELECT 1");
});

test("pull writes a Python source as the whole source object", async () => {
  const cwd = await scratch();
  const source = {
    type: "python",
    body: "def transform(orders):\n    return orders",
    "source-tables": [{ alias: "orders", database_id: 1, schema: "public", table: "orders" }],
  };
  const { deps } = toolDeps(transformWith(source), cwd, EE_59);

  const result = await runTransformWriteTool(deps, { method: "pull", id: 4 });

  const file = join(cwd, "transform-4.source.json");
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled transform 4 source to ${file}`,
    value: {
      file,
      note: `Edit the file, then apply it with {method: "update", id: 4, source_file: "${file}"}.`,
    },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(source);
});

test("pull keeps a tagged native query whole — bare SQL could not round-trip its tags", async () => {
  const cwd = await scratch();
  const source = {
    type: "query",
    query: {
      "lib/type": "mbql/query",
      database: 1,
      stages: [
        {
          "lib/type": "mbql.stage/native",
          native: "SELECT * FROM orders WHERE {{state}}",
          "template-tags": { state: { type: "dimension", name: "state" } },
        },
      ],
    },
  };
  const { deps } = toolDeps(transformWith(source), cwd, EE_59);

  await runTransformWriteTool(deps, { method: "pull", id: 4 });

  const file = join(cwd, "transform-4.source.json");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(source);
});

test("pull keeps an incremental SQL source whole — bare SQL would drop the strategy", async () => {
  const cwd = await scratch();
  const source = {
    ...SOURCE,
    "source-incremental-strategy": { type: "checkpoint", "checkpoint-filter-field-id": 9 },
  };
  const { deps } = toolDeps(transformWith(source), cwd, EE_59);

  await runTransformWriteTool(deps, { method: "pull", id: 4 });

  const file = join(cwd, "transform-4.source.json");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(source);
});

test("pull requires an id", async () => {
  const { deps } = toolDeps(TRANSFORM, "/tmp", EE_59);

  await expect(runTransformWriteTool(deps, { method: "pull" })).rejects.toThrow(
    "`id` is required for the `pull` method.",
  );
});

test("a v58 instance refuses before any request leaves", async () => {
  const { deps, requests } = toolDeps(TRANSFORM, "/tmp", OSS_58);

  await expect(
    runTransformWriteTool(deps, {
      method: "create",
      name: "Daily orders",
      source: SOURCE,
      target: TARGET,
    }),
  ).rejects.toThrow(
    new TeachingError(
      "`transform_write` needs Metabase v59 or newer; this instance is v0.58.0. There is no workaround from this session.",
    ),
  );
  expect(requests).toEqual([]);
});

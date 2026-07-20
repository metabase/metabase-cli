import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runDocumentWriteTool, withNodeIds } from "./document-write";
import { type Responder, toolDeps } from "./fake-client";

const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tempDirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mb-agent-docw-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface DocumentFixture {
  id: number;
  name: string;
  document: unknown;
  entity_id: string;
  collection_id: number;
  creator_id: number;
  archived: boolean;
  can_write: boolean;
  created_at: string;
  updated_at: string;
}

function documentFixture(body: unknown = { type: "doc", content: [] }): DocumentFixture {
  return {
    id: 7,
    name: "Q3 review",
    document: body,
    entity_id: "e",
    collection_id: 5,
    creator_id: 1,
    archived: false,
    can_write: true,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  };
}

const DOCUMENT: Responder = () => documentFixture();

test("every block node that needs an `_id` gets one, recursively", () => {
  const minted = withNodeIds({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Q3" }] },
      {
        type: "bulletList",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Revenue held." }] }],
      },
    ],
  });

  const doc = expectObject(minted);
  expect(doc["attrs"]).toBeUndefined();

  const [heading, bulletList] = expectArray(doc["content"]);
  const headingAttrs = expectObject(expectObject(heading)["attrs"]);
  expect(headingAttrs["level"]).toBe(2);
  expect(headingAttrs["_id"]).toMatch(NODE_ID);

  const list = expectObject(bulletList);
  expect(expectObject(list["attrs"])["_id"]).toMatch(NODE_ID);

  const [paragraph] = expectArray(list["content"]);
  const paragraphNode = expectObject(paragraph);
  expect(expectObject(paragraphNode["attrs"])["_id"]).toMatch(NODE_ID);

  const [text] = expectArray(paragraphNode["content"]);
  expect(expectObject(text)).toEqual({ type: "text", text: "Revenue held." });
});

test("an `_id` the caller already set is left alone", () => {
  const minted = withNodeIds({
    type: "paragraph",
    attrs: { _id: "keep-me" },
    content: [{ type: "text", text: "Hi" }],
  });

  expect(minted).toEqual({
    type: "paragraph",
    attrs: { _id: "keep-me" },
    content: [{ type: "text", text: "Hi" }],
  });
});

test("create posts the minted body and the placeholder cards", async () => {
  const { deps, requests } = toolDeps(DOCUMENT);

  const result = await runDocumentWriteTool(deps, {
    method: "create",
    name: "Q3 review",
    collection_id: 5,
    document: {
      type: "doc",
      content: [{ type: "cardEmbed", attrs: { id: -1 } }],
    },
    cards: {
      "-1": {
        name: "Revenue",
        dataset_query: { database: 1 },
        display: "line",
        visualization_settings: {},
      },
    },
  });

  expect(requests).toHaveLength(1);
  const body = requests[0]?.options?.body;
  const posted = expectObject(body);
  const document = expectObject(posted["document"]);
  const [embed] = expectArray(document["content"]);
  const attrs = expectObject(expectObject(embed)["attrs"]);
  expect(attrs["id"]).toBe(-1);
  expect(attrs["_id"]).toMatch(NODE_ID);
  expect(posted["name"]).toBe("Q3 review");
  expect(posted["collection_id"]).toBe(5);
  expect(posted["cards"]).toEqual({
    "-1": {
      name: "Revenue",
      dataset_query: { database: 1 },
      display: "line",
      visualization_settings: {},
    },
  });
  expect(result.details).toEqual({
    kind: "json",
    label: "created document 7",
    noun: "document",
    value: {
      id: 7,
      name: "Q3 review",
      collection_id: 5,
      archived: false,
      creator_id: 1,
      can_write: true,
    },
  });
});

// The API refuses to destroy a live document ("Document must be archived before it can be deleted"),
// so a bare DELETE would fail on every document the caller has not already trashed.
test("delete archives first, then destroys", async () => {
  const { deps, requests } = toolDeps(DOCUMENT);

  const result = await runDocumentWriteTool(deps, { method: "delete", id: 7 });

  expect(requests).toEqual([
    {
      path: "/api/document/7",
      method: "PUT",
      options: { method: "PUT", body: { archived: true } },
    },
    {
      path: "/api/document/7",
      method: "DELETE",
      options: { method: "DELETE", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "deleted document 7 permanently — cards it embedded by id are untouched",
    value: { id: 7, deleted: true },
  });
});

const PULLED_BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { _id: "keep-me" },
      content: [{ type: "text", text: "Revenue held." }],
    },
  ],
};

test("pull writes the saved body to a file with its _ids intact and names the way back", async () => {
  const cwd = await scratch();
  const { deps, requests } = toolDeps(() => documentFixture(PULLED_BODY), cwd);

  const result = await runDocumentWriteTool(deps, { method: "pull", id: 7 });

  const file = join(cwd, "document-7.json");
  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/document/7",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: `pulled document 7 body to ${file}`,
    value: {
      file,
      note: `Edit the file, then apply it with {method: "update", id: 7, document_file: "${file}"}. The body replaces the whole tree — keep the _id attributes exactly as pulled, and leave _id off the nodes you add.`,
    },
  });
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(PULLED_BODY);
});

test("pull then update round-trips the pulled tree byte-identically", async () => {
  const cwd = await scratch();
  const { deps, requests } = toolDeps(() => documentFixture(PULLED_BODY), cwd);

  await runDocumentWriteTool(deps, { method: "pull", id: 7 });
  await runDocumentWriteTool(deps, {
    method: "update",
    id: 7,
    document_file: join(cwd, "document-7.json"),
  });

  expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
    "GET /api/document/7",
    "PUT /api/document/7",
  ]);
  expect(requests[1]?.options?.body).toEqual({ document: PULLED_BODY });
});

test("pull on a document with no body names the problem", async () => {
  const { deps } = toolDeps(() => documentFixture(null));

  await expect(runDocumentWriteTool(deps, { method: "pull", id: 7 })).rejects.toThrow(
    'Document 7 has no body to pull — author one and save it with {method: "update", id: 7, document_file: "<path>"}.',
  );
});

test("pull requires an id", async () => {
  const { deps } = toolDeps(DOCUMENT);

  await expect(runDocumentWriteTool(deps, { method: "pull" })).rejects.toThrow(
    "`id` is required for the `pull` method.",
  );
});

function expectObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  }
  return { ...value };
}

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected an array, got ${JSON.stringify(value)}`);
  }
  return value;
}

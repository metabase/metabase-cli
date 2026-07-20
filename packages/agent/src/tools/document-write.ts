import { randomUUID } from "node:crypto";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Document,
  DocumentCompact,
  DocumentCreateInput,
  DocumentUpdateInput,
  TIPTAP_NODE_TYPES_WITH_ID,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { readJsonFileInput } from "./file-input";
import { writeJsonFileOutput } from "./file-output";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { readSkillsFirst, type SkillName, skillsAfterRejection } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { entityResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";
import { assertExactlyOneOf, assertMethodRequirements, missingFieldError } from "./write-recipe";

const SKILLS: readonly SkillName[] = ["document"];
const NEEDS_ID: ReadonlySet<string> = new Set(TIPTAP_NODE_TYPES_WITH_ID);

const DOCUMENT_METHODS = ["pull", "create", "update", "delete"] as const;
type DocumentMethod = (typeof DOCUMENT_METHODS)[number];

const parameters = Type.Object({
  method: Type.Unsafe<DocumentMethod>({
    type: "string",
    enum: [...DOCUMENT_METHODS],
    description:
      "`pull` writes the document's saved body to a file for editing; `create` a new document; `update` an existing one; `delete` one — permanent, with no trash behind it. Per-method required fields are named in each parameter's description; supplying the wrong set returns a teaching error naming the missing field.",
  }),
  id: Type.Optional(
    Type.Integer({ description: "Document id. Required for `pull`, `update` and `delete`." }),
  ),
  name: Type.Optional(Type.String({ description: "Document title. Required for `create`." })),
  document: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        'The body, as a TipTap document tree: `{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Q3"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Revenue held."}]}]}`. A saved question is embedded as a `cardEmbed` node (`{"type": "cardEmbed", "attrs": {"id": <card id>}}`), which is what makes a document a narrative with live results in it rather than static text. Block nodes need an `_id` attribute — this tool mints the missing ones, so leave them out. Required for `create`; on `update` it replaces the whole body.',
    }),
  ),
  document_file: Type.Optional(
    Type.String({
      description:
        "Path to a JSON file holding the same body — a long document belongs on disk, where you can edit it with the file tools, not in this conversation. On `pull` the tool writes the saved body to this path instead (default `document-<id>.json`).",
    }),
  ),
  cards: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        'New cards to create alongside the document, keyed by a negative placeholder id (`{"-1": {name, dataset_query, display, visualization_settings}}`). A `cardEmbed` node referencing `{"id": -1}` binds to it. Use it only for cards that exist solely inside this document; a card that should be reusable is created with `question_write` and embedded by its real id.',
    }),
  ),
  collection_id: Type.Optional(
    Type.Integer({
      description: "Collection to save the document in. Omit for the root collection.",
    }),
  ),
  archived: Type.Optional(
    Type.Boolean({
      description:
        '`update` only: `true` sends the document to the trash (recoverable), `false` restores it. `method: "delete"` destroys it outright.',
    }),
  ),
});

export function documentWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "document_write",
    label: "Write document",
    description:
      `${readSkillsFirst(SKILLS)}\n\n` +
      'Create, update, pull or delete a document — Metabase\'s narrative surface: prose with saved questions embedded in it, which re-run whenever the document is opened. It is the right home for an analysis with a story around it, where a dashboard is the right home for numbers to monitor. To edit an existing document, `{method: "pull", id}` writes its body to a file — edit it on disk (keeping every `_id` as pulled), then `update` with the same path; the body replaces the whole tree.\n\nExamples: `{method: "create", name: "Q3 review", document_file: "q3.json", collection_id: 5}` · `{method: "pull", id: 7}` · `{method: "update", id: 7, archived: true}`',
    parameters,
    execute: (_id, params) => runDocumentWriteTool(deps, params),
  });
}

type DocumentWriteParams = Static<typeof parameters>;

export function runDocumentWriteTool(
  deps: MetabaseToolDeps,
  params: DocumentWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertMethodRequirements(params.method, params, {
      pull: ["id"],
      create: ["name"],
      update: ["id"],
      delete: ["id"],
    });

    if (params.method === "pull") {
      return await runDocumentPull(deps, params);
    }
    if (params.method === "delete") {
      return await deleteDocument(deps, requireId(params));
    }

    const body = await resolveBody(deps, params);
    const fields = {
      name: params.name,
      document: body,
      cards: params.cards,
      collection_id: params.collection_id,
    };

    if (params.method === "create") {
      const created = await deps.client.requestParsed(Document, "/api/document", {
        method: "POST",
        body: DocumentCreateInput.parse(fields),
      });
      return entityResult(
        "document",
        `created document ${String(created.id)}`,
        DocumentCompact.parse(created),
      );
    }

    const updated = await deps.client.requestParsed(
      Document,
      `/api/document/${String(params.id)}`,
      { method: "PUT", body: DocumentUpdateInput.parse({ ...fields, archived: params.archived }) },
    );
    return entityResult(
      "document",
      `updated document ${String(updated.id)}`,
      DocumentCompact.parse(updated),
    );
  }, skillsAfterRejection(SKILLS));
}

const PULLED_DOCUMENT_FILE = (id: number): string => `document-${id}.json`;

async function runDocumentPull(
  deps: MetabaseToolDeps,
  params: DocumentWriteParams,
): Promise<TextToolResult> {
  const id = requireId(params);
  const document = await deps.client.requestParsed(Document, `/api/document/${String(id)}`);
  if (document.document === null) {
    throw new TeachingError(
      `Document ${id} has no body to pull — author one and save it with {method: "update", id: ${id}, document_file: "<path>"}.`,
    );
  }
  const file = await writeJsonFileOutput(
    deps.cwd,
    params.document_file ?? PULLED_DOCUMENT_FILE(id),
    document.document,
  );
  return jsonResult(`pulled document ${id} body to ${file}`, {
    file,
    note: `Edit the file, then apply it with {method: "update", id: ${id}, document_file: "${file}"}. The body replaces the whole tree — keep the _id attributes exactly as pulled, and leave _id off the nodes you add.`,
  });
}

// The API refuses to destroy a live document — it must sit in the trash first. That is two calls for
// one intent, and a model that meets the refusal has no way to read "archive it, then ask again" out
// of it, so `delete` does both.
async function deleteDocument(deps: MetabaseToolDeps, id: number): Promise<TextToolResult> {
  await deps.client.requestParsed(Document, `/api/document/${String(id)}`, {
    method: "PUT",
    body: DocumentUpdateInput.parse({ archived: true }),
  });
  await deps.client.requestRaw(`/api/document/${String(id)}`, {
    method: "DELETE",
    expectContentType: "binary",
  });
  return jsonResult(
    `deleted document ${String(id)} permanently — cards it embedded by id are untouched`,
    { id, deleted: true },
  );
}

async function resolveBody(
  deps: MetabaseToolDeps,
  params: DocumentWriteParams,
): Promise<JsonValue | undefined> {
  const sources = ["document", "document_file"] as const;
  const provided = sources.filter((key) => params[key] !== undefined);
  if (params.method === "create" || provided.length > 0) {
    assertExactlyOneOf(params, sources, "document body");
  }

  if (params.document !== undefined) {
    return withNodeIds(jsonValueSchema.parse(params.document));
  }
  if (params.document_file !== undefined) {
    const raw = await readJsonFileInput(deps.cwd, params.document_file, "document_file");
    return withNodeIds(raw);
  }
  return undefined;
}

/**
 * The document API rejects a tree whose block nodes lack an `attrs._id` — the anchor the editor
 * uses for comments and links. Minting them is pure ceremony for a model to do by hand, and one
 * missing id rejects the whole body, so the tool does it.
 */
export function withNodeIds(value: JsonValue): JsonValue {
  if (!isJsonObject(value)) {
    return value;
  }
  const node: Record<string, JsonValue> = { ...value };
  const content = node["content"];
  if (Array.isArray(content)) {
    node["content"] = content.map(withNodeIds);
  }
  const type = node["type"];
  if (typeof type !== "string" || !NEEDS_ID.has(type)) {
    return node;
  }
  const attrs = node["attrs"];
  const existing = isJsonObject(attrs) ? attrs["_id"] : undefined;
  if (typeof existing === "string" && existing !== "") {
    return node;
  }
  node["attrs"] = { ...(isJsonObject(attrs) ? attrs : {}), _id: randomUUID() };
  return node;
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireId(params: DocumentWriteParams): number {
  if (params.id === undefined) {
    throw missingFieldError(params.method, ["id"], params);
  }
  return params.id;
}

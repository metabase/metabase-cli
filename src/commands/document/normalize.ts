import { TipTapNode } from "../../domain/document";

const ID_ATTRIBUTE = "_id";
const PARAGRAPH_NODE_TYPE = "paragraph";

// The TipTap editor mints `_id` only on these node types (each opts in via `createIdAttribute()`),
// and drops the attr on any other type when it parses the stored JSON — so writing `_id` elsewhere
// is dead data. The editor backfills missing ids on load, which is what flags a freshly-created doc
// as dirty; we pre-fill them here so it opens clean. The frontend is the source of truth for this set.
const ID_BEARING_NODE_TYPES = new Set([
  PARAGRAPH_NODE_TYPE,
  "heading",
  "codeBlock",
  "orderedList",
  "bulletList",
  "blockquote",
  "cardEmbed",
  "supportingText",
]);

function randomNodeId(): string {
  return globalThis.crypto.randomUUID();
}

export function normalizeDocumentBody(
  doc: TipTapNode,
  makeId: () => string = randomNodeId,
): TipTapNode {
  const usedIds = new Set<string>();
  const withIds = assignNodeIds(doc, usedIds, makeId);
  return ensureTrailingParagraph(withIds, makeId);
}

function assignNodeIds(node: TipTapNode, usedIds: Set<string>, makeId: () => string): TipTapNode {
  let attrs = node.attrs;
  if (ID_BEARING_NODE_TYPES.has(node.type)) {
    const id = resolveNodeId(node, usedIds, makeId);
    if (id !== node.attrs?.[ID_ATTRIBUTE]) {
      attrs = { ...node.attrs, [ID_ATTRIBUTE]: id };
    }
  }

  let content = node.content;
  if (content !== undefined) {
    const original = content;
    const mapped = original.map((child) => assignNodeIds(child, usedIds, makeId));
    if (mapped.some((child, index) => child !== original[index])) {
      content = mapped;
    }
  }

  if (attrs === node.attrs && content === node.content) {
    return node;
  } else {
    return { ...node, attrs, content };
  }
}

function resolveNodeId(node: TipTapNode, usedIds: Set<string>, makeId: () => string): string {
  const existing = node.attrs?.[ID_ATTRIBUTE];
  const id = typeof existing === "string" && !usedIds.has(existing) ? existing : makeId();
  usedIds.add(id);
  return id;
}

// The editor's trailing-node extension appends an empty paragraph on load whenever the document's
// last top-level child isn't a paragraph, which is the other source of open-on-dirty.
function ensureTrailingParagraph(doc: TipTapNode, makeId: () => string): TipTapNode {
  if (doc.type !== "doc") {
    return doc;
  }
  const content = doc.content ?? [];
  const last = content[content.length - 1];
  if (last != null && last.type === PARAGRAPH_NODE_TYPE) {
    return doc;
  }
  const trailing: TipTapNode = { type: PARAGRAPH_NODE_TYPE, attrs: { [ID_ATTRIBUTE]: makeId() } };
  return { ...doc, content: [...content, trailing] };
}

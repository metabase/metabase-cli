import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  COLLECTION_ITEM_FILTER_MODELS,
  CollectionItem,
  CollectionItemCompact,
  CollectionTreeNode,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import type { MetabaseToolDeps } from "./deps";
import { buildListEnvelope } from "./envelope";
import { type CollectionLocator, resolveCollectionLocator } from "./locator";
import { type ResponseFormat, resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import { guardTool, jsonResult, listResult, type TextToolResult } from "./tool-result";

const MODES = ["items", "tree"] as const;
type Mode = (typeof MODES)[number];

const TREE_DEFAULT_DEPTH = 2;
const TREE_CHILD_CAP = 100;
const ITEMS_DEFAULT_LIMIT = 50;

const ItemsEnvelope = z
  .object({
    data: z.array(CollectionItem),
    total: z.number().int().nonnegative().optional(),
    limit: z.number().int().nullable().optional(),
    offset: z.number().int().nullable().optional(),
  })
  .loose();

const TreeResponse = z.array(CollectionTreeNode);

const parameters = Type.Object({
  id: Type.Union([Type.Integer(), Type.String()], {
    description: 'Collection id (number), 21-char entity id, "root", or "trash".',
  }),
  mode: Type.Optional(
    Type.Unsafe<Mode>({
      type: "string",
      enum: [...MODES],
      description:
        "`items` (default) lists a collection's contents; `tree` shows the collection hierarchy (collections only).",
    }),
  ),
  type: Type.Optional(
    Type.Array(Type.String(), {
      description: `items mode: restrict to these models: ${COLLECTION_ITEM_FILTER_MODELS.join(", ")}.`,
    }),
  ),
  depth: Type.Optional(
    Type.Integer({ description: `tree mode: levels to expand (default ${TREE_DEFAULT_DEPTH}).` }),
  ),
  limit: Type.Optional(
    Type.Integer({ description: `items mode: max items (default ${ITEMS_DEFAULT_LIMIT}).` }),
  ),
  offset: Type.Optional(
    Type.Integer({ description: "items mode: skip this many items (pagination)." }),
  ),
  response_format: responseFormatParam,
});

export function browseCollectionTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "browse_collection",
    label: "Browse collection",
    description:
      'Navigate collections. `mode: "items"` (default) lists a collection\'s contents (pinned first), filterable by `type` and paginated. `mode: "tree"` shows the collection hierarchy (collections only), re-rooted at `id` and expanded to `depth`. Address a collection by numeric id, entity id, `"root"`, or `"trash"`.\n\nExamples: `{id: 4}` · `{id: "root", mode: "tree", depth: 2}` · `{id: "trash"}`',
    parameters,
    execute: (_id, params) => runBrowseCollectionTool(deps, params),
  });
}

type BrowseCollectionToolParams = Static<typeof parameters>;

export function runBrowseCollectionTool(
  deps: MetabaseToolDeps,
  params: BrowseCollectionToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const format = resolveResponseFormat(params.response_format);
    const mode: Mode = params.mode ?? "items";
    if (mode === "tree") {
      const roots = await runTree(deps, params.id, params.depth ?? TREE_DEFAULT_DEPTH);
      return jsonResult(`collection tree (${roots.length} roots)`, { data: roots });
    }
    return runItems(deps, params, format);
  });
}

interface BrowseParams {
  id: CollectionLocator;
  type?: string[];
  limit?: number;
  offset?: number;
}

async function runItems(
  deps: MetabaseToolDeps,
  params: BrowseParams,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const ref = resolveCollectionLocator(params.id);
  const limit = params.limit ?? ITEMS_DEFAULT_LIMIT;
  const response = await deps.client.requestParsed(ItemsEnvelope, `/api/collection/${ref}/items`, {
    query: { models: params.type, limit, offset: params.offset },
  });
  const ordered = pinnedFirst(response.data);
  const items = ordered.map((item) =>
    format === "detailed" ? item : CollectionItemCompact.parse(item),
  );
  const envelope = buildListEnvelope(items, {
    total: response.total ?? items.length,
    steering: { noun: "items", narrowWith: ["type"], pageWith: "offset" },
  });
  return listResult("items", envelope, format);
}

function pinnedFirst(items: CollectionItem[]): CollectionItem[] {
  const pinned = items.filter(
    (item) => item.collection_position !== null && item.collection_position !== undefined,
  );
  const rest = items.filter(
    (item) => item.collection_position === null || item.collection_position === undefined,
  );
  return [...pinned, ...rest];
}

interface TreeView {
  id: CollectionTreeNode["id"];
  name: string;
  description?: string | null;
  children: TreeView[];
  truncated?: string;
}

async function runTree(
  deps: MetabaseToolDeps,
  id: CollectionLocator,
  depth: number,
): Promise<TreeView[]> {
  const ref = resolveCollectionLocator(id);
  if (ref === "trash") {
    throw new TeachingError(
      '`tree` mode covers content collections only — call browse_collection with `id: "trash"` and the default `items` mode to see trashed content.',
    );
  }
  const forest = await deps.client.requestParsed(TreeResponse, "/api/collection/tree");
  const roots = ref === "root" ? forest : subtreeRoots(forest, ref);
  if (roots === null) {
    throw new TeachingError(
      `Collection ${JSON.stringify(id)} was not found in the collection tree.`,
    );
  }
  return roots.map((node) => renderNode(node, depth));
}

function subtreeRoots(forest: CollectionTreeNode[], ref: string): CollectionTreeNode[] | null {
  const match = findNode(forest, ref);
  return match === null ? null : match.children;
}

function findNode(nodes: CollectionTreeNode[], ref: string): CollectionTreeNode | null {
  for (const node of nodes) {
    if (String(node.id) === ref) {
      return node;
    }
    const nested = findNode(node.children, ref);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function renderNode(node: CollectionTreeNode, depth: number): TreeView {
  const view: TreeView = { id: node.id, name: node.name, children: [] };
  if (node.description !== undefined) {
    view.description = node.description;
  }
  if (depth <= 0) {
    if (node.children.length > 0) {
      view.truncated = `${node.children.length} nested collections — expand with browse_collection(id: ${treeId(node)}, mode: "tree")`;
    }
    return view;
  }
  const shown = node.children.slice(0, TREE_CHILD_CAP);
  view.children = shown.map((child) => renderNode(child, depth - 1));
  if (node.children.length > TREE_CHILD_CAP) {
    view.truncated = `${node.children.length - TREE_CHILD_CAP} more child collections — expand with browse_collection(id: ${treeId(node)}, mode: "tree")`;
  }
  return view;
}

function treeId(node: CollectionTreeNode): string {
  return typeof node.id === "number" ? String(node.id) : JSON.stringify(node.id);
}

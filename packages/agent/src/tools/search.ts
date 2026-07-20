import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CurrentUser, SEARCH_MODELS, SearchModel, SearchResult } from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import type { MetabaseToolDeps } from "./deps";
import { buildListEnvelope } from "./envelope";
import { type ResponseFormat, resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import { guardTool, listResult, type TextToolResult } from "./tool-result";

// The search index names a question `card` and a model `dataset`, while every write tool (and the
// user) says `question` and `model`. Both vocabularies are accepted here and normalized to the
// index's.
const TYPE_ALIASES: Readonly<Record<string, SearchModel>> = {
  question: "card",
  model: "dataset",
};

const SEARCH_TYPES = [...SEARCH_MODELS, ...Object.keys(TYPE_ALIASES)];

const CREATORLESS_MODELS: ReadonlySet<string> = new Set([
  "collection",
  "database",
  "table",
  "segment",
  "transform",
  "indexed-entity",
]);

const DEFAULT_LIMIT = 20;

const SearchEnvelope = z
  .object({
    data: z.array(SearchResult),
    total: z.number().int().nonnegative(),
    limit: z.number().int().nullable().optional(),
    offset: z.number().int().nullable().optional(),
  })
  .loose();

const RecentItem = z
  .object({
    id: z.union([z.number().int(), z.string()]),
    model: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
  })
  .loose();

const RecentsEnvelope = z.object({ recents: z.array(RecentItem) }).loose();

const SearchResultConcise = SearchResult.pick({
  id: true,
  name: true,
  model: true,
  description: true,
  collection: true,
}).strip();

const parameters = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        "Keyword search string. Ranked keyword match only — the REST search API exposes no semantic search to API-key callers.",
    }),
  ),
  type: Type.Optional(
    Type.Array(Type.Unsafe<string>({ type: "string", enum: SEARCH_TYPES }), {
      description: `Restrict to these content types: ${SEARCH_MODELS.join(", ")}. A question is indexed as \`card\` and a model as \`dataset\`; \`question\` and \`model\` are accepted and translated.`,
    }),
  ),
  collection_id: Type.Optional(
    Type.Integer({ description: "Restrict to a collection and its descendants (numeric id)." }),
  ),
  created_by: Type.Optional(
    Type.Literal("me", {
      description: 'Restrict to content the current user created. Only "me" is supported.',
    }),
  ),
  archived: Type.Optional(
    Type.Boolean({ description: "Search the trash instead of active content." }),
  ),
  recent: Type.Optional(
    Type.Boolean({
      description:
        "Return the current user's recently viewed items instead of running a keyword search. Cannot be combined with `query`.",
    }),
  ),
  limit: Type.Optional(Type.Integer({ description: `Max results (default ${DEFAULT_LIMIT}).` })),
  offset: Type.Optional(Type.Integer({ description: "Skip this many results (pagination)." })),
  response_format: responseFormatParam,
});

type SearchToolParams = Static<typeof parameters>;

export function searchTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "search",
    label: "Search",
    description:
      'Find Metabase content by keyword across cards, models, metrics, dashboards, collections, tables, segments, and more. Filter by `type`, `collection_id` (subtree scope), `created_by: "me"`, and `archived`. Set `recent: true` for your recently viewed items. Snippets are absent from the search index — list them with `browse_collection` on a snippet folder or `get_content`.\n\nExamples: `{query: "orders"}` · `{type: ["dashboard"], collection_id: 4}` · `{recent: true}`',
    parameters,
    execute: (_id, params) => runSearchTool(deps, params),
  });
}

export function runSearchTool(
  deps: MetabaseToolDeps,
  params: SearchToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const format = resolveResponseFormat(params.response_format);
    const types = normalizeTypes(params.type);
    if (params.recent === true) {
      if (params.query !== undefined && params.query.trim() !== "") {
        throw new TeachingError(
          "`recent` cannot be combined with `query` — recents is a small activity feed, not a searchable index. Drop one.",
        );
      }
      return runRecents(deps, types, format);
    }

    const hasQuery = params.query !== undefined && params.query.trim() !== "";
    const hasFilter =
      params.type !== undefined ||
      params.collection_id !== undefined ||
      params.created_by !== undefined ||
      params.archived === true;
    if (!hasQuery && !hasFilter) {
      throw new TeachingError(
        "Empty search. Pass one of: `query` (keyword search), a filter (`type`, `collection_id`, `created_by`, `archived`), or `recent: true` (recently viewed).",
      );
    }

    assertCreatorFilter(params.created_by, types);
    return runSearch(deps, params, types, format);
  });
}

interface SearchParams {
  query?: string;
  collection_id?: number;
  created_by?: "me";
  archived?: boolean;
  limit?: number;
  offset?: number;
}

async function runSearch(
  deps: MetabaseToolDeps,
  params: SearchParams,
  types: SearchModel[] | undefined,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const createdBy = params.created_by === "me" ? await currentUserId(deps) : undefined;
  const response = await deps.client.requestParsed(SearchEnvelope, "/api/search", {
    query: {
      q: params.query?.trim() || undefined,
      models: types,
      collection: params.collection_id,
      created_by: createdBy,
      archived: params.archived ? true : undefined,
      limit,
      offset: params.offset,
    },
  });
  const items = response.data.map((item) => project(item, format));
  const envelope = buildListEnvelope(items, {
    total: response.total,
    steering: { noun: "results", narrowWith: ["type", "collection_id"], pageWith: "offset" },
  });
  return listResult("results", envelope, format);
}

async function runRecents(
  deps: MetabaseToolDeps,
  types: SearchModel[] | undefined,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const response = await deps.client.requestParsed(RecentsEnvelope, "/api/activity/recents", {
    query: { context: "views" },
  });
  const filtered =
    types === undefined
      ? response.recents
      : response.recents.filter((item) => types.some((type) => type === item.model));
  const items = filtered.map((item) => (format === "detailed" ? item : RecentItem.parse(item)));
  const envelope = buildListEnvelope(items, {
    total: filtered.length,
    steering: { noun: "recently viewed items", narrowWith: ["type"] },
  });
  return listResult("recently viewed items", envelope, format);
}

function project(item: SearchResult, format: ResponseFormat): unknown {
  return format === "detailed" ? item : SearchResultConcise.parse(item);
}

function normalizeTypes(types: string[] | undefined): SearchModel[] | undefined {
  if (types === undefined) {
    return undefined;
  }
  return types.map((type) => {
    const alias = TYPE_ALIASES[type];
    if (alias !== undefined) {
      return alias;
    }
    const canonical = SearchModel.safeParse(type);
    if (canonical.success) {
      return canonical.data;
    }
    throw new TeachingError(
      `Unknown search type ${JSON.stringify(type)}. Pass one of: ${SEARCH_TYPES.join(", ")}.`,
    );
  });
}

function assertCreatorFilter(createdBy: "me" | undefined, types: SearchModel[] | undefined): void {
  if (createdBy === undefined || types === undefined) {
    return;
  }
  const creatorless = types.filter((model) => CREATORLESS_MODELS.has(model));
  if (creatorless.length > 0) {
    throw new TeachingError(
      `\`created_by\` does not apply to ${creatorless.join(", ")} — those types record no creator. Drop \`created_by\` or remove ${creatorless.join(", ")} from \`type\`.`,
    );
  }
}

async function currentUserId(deps: MetabaseToolDeps): Promise<number> {
  const user = await deps.client.requestParsed(CurrentUser, "/api/user/current");
  return user.id;
}

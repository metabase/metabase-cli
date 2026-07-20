import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Card,
  CardCompact,
  Collection,
  CollectionCompact,
  Dashboard,
  DashboardCompact,
  Document,
  DocumentCompact,
  Measure,
  MeasureCompact,
  Segment,
  SegmentCompact,
  Snippet,
  SnippetCompact,
  Transform,
  TransformCompact,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import type { Client } from "@metabase/cli/client";
import type { MetabaseToolDeps } from "./deps";
import { resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import { errorMessageOf, guardTool, jsonResult, type TextToolResult } from "./tool-result";

const CONTENT_TYPES = [
  "question",
  "model",
  "metric",
  "measure",
  "dashboard",
  "collection",
  "snippet",
  "segment",
  "document",
  "transform",
] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

const INCLUDE_SECTIONS = ["definition", "fields", "parameters", "layout", "revisions"] as const;
type IncludeSection = (typeof INCLUDE_SECTIONS)[number];

const BATCH_CAP = 10;

const parameters = Type.Object({
  items: Type.Array(
    Type.Object({
      type: Type.Unsafe<ContentType>({ type: "string", enum: [...CONTENT_TYPES] }),
      id: Type.Integer(),
    }),
    {
      description: `Up to ${BATCH_CAP} {type, id} pairs; mixed types allowed. One bad id fails that item, not the batch.`,
    },
  ),
  include: Type.Optional(
    Type.Array(Type.Unsafe<IncludeSection>({ type: "string", enum: [...INCLUDE_SECTIONS] }), {
      description:
        "Extra sections to attach where meaningful: definition, fields, parameters, layout, revisions. Sections that don't fit an item's type are named in its `skipped_include`.",
    }),
  ),
  response_format: responseFormatParam,
});

export function getContentTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "get_content",
    label: "Get content",
    description:
      'Read one or more Metabase entities in a single batch: question, model, metric, measure, dashboard, collection, snippet, segment, document, transform. Each item echoes its `type` and `id`. Use `include` to pull extra sections (definition, fields, parameters, layout, revisions).\n\nExamples: `{items: [{type: "dashboard", id: 3}]}` · `{items: [{type: "question", id: 5}], include: ["definition", "revisions"]}`',
    parameters,
    execute: (_id, params) => runGetContentTool(deps, params),
  });
}

type GetContentToolParams = Static<typeof parameters>;

export function runGetContentTool(
  deps: MetabaseToolDeps,
  params: GetContentToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    if (params.items.length === 0) {
      throw new TeachingError("`items` is empty — pass at least one {type, id} pair.");
    }
    if (params.items.length > BATCH_CAP) {
      throw new TeachingError(
        `Too many items (${params.items.length}); the cap is ${BATCH_CAP}. Split into separate calls.`,
      );
    }
    const format = resolveResponseFormat(params.response_format);
    const include = params.include ?? [];
    const data: unknown[] = [];
    const errors: ContentError[] = [];
    for (const item of params.items) {
      try {
        data.push(await fetchItem(deps, item.type, item.id, format, include));
      } catch (error) {
        errors.push({ type: item.type, id: item.id, error: errorMessageOf(error) });
      }
    }
    return jsonResult(`${data.length} of ${params.items.length} items`, { data, errors });
  });
}

interface ContentError {
  type: ContentType;
  id: number;
  error: string;
}

interface TypeHandler {
  endpoint: (id: number) => string;
  schema: z.ZodType;
  compact: z.ZodType;
  revisionEntity: string | null;
  sections: Partial<Record<IncludeSection, (raw: unknown) => unknown>>;
}

const CardSections = z
  .object({
    dataset_query: z.unknown().optional(),
    parameters: z.array(z.unknown()).nullish(),
    result_metadata: z.array(z.unknown()).nullish(),
  })
  .loose();

const DefinitionSection = z.object({ definition: z.unknown().optional() }).loose();
const DashboardSections = z
  .object({
    parameters: z.array(z.unknown()).nullish(),
    tabs: z.array(z.unknown()).nullish(),
    dashcards: z.array(z.unknown()).nullish(),
  })
  .loose();
const TransformSectionSchema = z.object({ source: z.unknown().optional() }).loose();

function cardHandler(): TypeHandler {
  return {
    endpoint: (id) => `/api/card/${id}`,
    schema: Card,
    compact: CardCompact,
    revisionEntity: "card",
    sections: {
      definition: (raw) => CardSections.parse(raw).dataset_query ?? null,
      parameters: (raw) => CardSections.parse(raw).parameters ?? null,
      fields: (raw) => CardSections.parse(raw).result_metadata ?? null,
    },
  };
}

const HANDLERS: Record<ContentType, TypeHandler> = {
  question: cardHandler(),
  model: cardHandler(),
  metric: cardHandler(),
  measure: {
    endpoint: (id) => `/api/measure/${id}`,
    schema: Measure,
    compact: MeasureCompact,
    revisionEntity: "measure",
    sections: { definition: (raw) => DefinitionSection.parse(raw).definition ?? null },
  },
  segment: {
    endpoint: (id) => `/api/segment/${id}`,
    schema: Segment,
    compact: SegmentCompact,
    revisionEntity: "segment",
    sections: { definition: (raw) => DefinitionSection.parse(raw).definition ?? null },
  },
  dashboard: {
    endpoint: (id) => `/api/dashboard/${id}`,
    schema: Dashboard,
    compact: DashboardCompact,
    revisionEntity: "dashboard",
    sections: {
      parameters: (raw) => DashboardSections.parse(raw).parameters ?? null,
      layout: (raw) => {
        const parsed = DashboardSections.parse(raw);
        return { tabs: parsed.tabs ?? [], dashcards: parsed.dashcards ?? [] };
      },
    },
  },
  collection: {
    endpoint: (id) => `/api/collection/${id}`,
    schema: Collection,
    compact: CollectionCompact,
    revisionEntity: null,
    sections: {},
  },
  snippet: {
    endpoint: (id) => `/api/native-query-snippet/${id}`,
    schema: Snippet,
    compact: SnippetCompact,
    revisionEntity: null,
    sections: {},
  },
  document: {
    endpoint: (id) => `/api/document/${id}`,
    schema: Document,
    compact: DocumentCompact,
    revisionEntity: "document",
    sections: {},
  },
  transform: {
    endpoint: (id) => `/api/transform/${id}`,
    schema: Transform,
    compact: TransformCompact,
    revisionEntity: "transform",
    sections: { definition: (raw) => TransformSectionSchema.parse(raw).source ?? null },
  },
};

const RevisionList = z.array(z.object({ id: z.number().int() }).loose());

async function fetchItem(
  deps: MetabaseToolDeps,
  type: ContentType,
  id: number,
  format: string,
  include: IncludeSection[],
): Promise<unknown> {
  const handler = HANDLERS[type];
  const raw = await deps.client.requestParsed(handler.schema, handler.endpoint(id));
  const base = format === "detailed" ? raw : handler.compact.parse(raw);
  const item: Record<string, unknown> = { ...asRecord(base), type, id };

  const skipped: IncludeSection[] = [];
  for (const section of include) {
    const value = await resolveSection(deps, handler, section, raw, id);
    if (value === SKIP) {
      skipped.push(section);
    } else {
      item[section] = value;
    }
  }
  if (skipped.length > 0) {
    item["skipped_include"] = skipped;
  }
  return item;
}

const SKIP = Symbol("skip");

async function resolveSection(
  deps: MetabaseToolDeps,
  handler: TypeHandler,
  section: IncludeSection,
  raw: unknown,
  id: number,
): Promise<unknown> {
  if (section === "revisions") {
    if (handler.revisionEntity === null) {
      return SKIP;
    }
    return fetchRevisions(deps.client, handler.revisionEntity, id);
  }
  const producer = handler.sections[section];
  return producer === undefined ? SKIP : producer(raw);
}

async function fetchRevisions(client: Client, entity: string, id: number): Promise<unknown> {
  return client.requestParsed(RevisionList, "/api/revision", { query: { entity, id } });
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : {};
}

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Measure,
  MeasureCompact,
  MeasureCreateInput,
  MeasureUpdateInput,
  Segment,
  SegmentCompact,
  SegmentCreateInput,
  SegmentUpdateInput,
  Snippet,
  SnippetCompact,
  SnippetCreateInput,
  SnippetUpdateInput,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { readSkillsFirst, type SkillName, skillsAfterRejection } from "./skill-prereq";
import { entityResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";

const MBQL: readonly SkillName[] = ["mbql"];
import { assertMethodRequirements, methodSchema } from "./write-recipe";

const idParam = Type.Optional(Type.Integer({ description: "Entity id. Required for `update`." }));
const nameParam = Type.Optional(Type.String({ description: "Name. Required for `create`." }));
const descriptionParam = Type.Optional(Type.String());
const archivedParam = Type.Optional(
  Type.Boolean({
    description: "`update` only: `true` sends the entity to the trash, `false` restores it.",
  }),
);
const revisionMessageParam = Type.Optional(
  Type.String({
    description:
      "Why the definition changed — recorded in the revision history. Required for `update`; the API rejects an update without it.",
  }),
);
const tableIdParam = Type.Optional(
  Type.Integer({ description: "Table this definition attaches to. Required for `create`." }),
);
const definitionParam = Type.Optional(
  Type.Unsafe<Record<string, unknown>>({
    type: "object",
    additionalProperties: true,
    description:
      'A single-stage MBQL 5 query: `{"lib/type": "mbql/query", "database": <id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": <table id>, …}]}`. Required for `create`.',
  }),
);

const snippetParameters = Type.Object({
  method: methodSchema,
  id: idParam,
  name: nameParam,
  content: Type.Optional(
    Type.String({
      description: "The SQL fragment, without a trailing semicolon. Required for `create`.",
    }),
  ),
  description: descriptionParam,
  collection_id: Type.Optional(
    Type.Integer({
      description: "Snippet folder to file it under (a snippets-namespace collection).",
    }),
  ),
  archived: archivedParam,
});

export function snippetWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "snippet_write",
    label: "Write snippet",
    description:
      'Create or update a native-query snippet — a named SQL fragment other SQL questions paste in with `{{snippet: <name>}}`. Names are unique across snippets including archived ones, so a name collision can come from a snippet you cannot see in a listing.\n\nExamples: `{method: "create", name: "Active Rows", content: "deleted_at IS NULL"}` · `{method: "update", id: 3, content: "deleted_at IS NULL AND status = \'active\'"}`',
    parameters: snippetParameters,
    execute: (_id, params) => runSnippetWriteTool(deps, params),
  });
}

type SnippetWriteParams = Static<typeof snippetParameters>;

export function runSnippetWriteTool(
  deps: MetabaseToolDeps,
  params: SnippetWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertMethodRequirements(params.method, params, {
      create: ["name", "content"],
      update: ["id"],
    });
    const fields = {
      name: params.name,
      content: params.content,
      description: params.description,
      collection_id: params.collection_id,
    };

    if (params.method === "create") {
      const created = await deps.client.requestParsed(Snippet, "/api/native-query-snippet", {
        method: "POST",
        body: SnippetCreateInput.parse(fields),
      });
      return jsonResult(`created snippet ${created.id}`, SnippetCompact.parse(created));
    }

    const updated = await deps.client.requestParsed(
      Snippet,
      `/api/native-query-snippet/${String(params.id)}`,
      { method: "PUT", body: SnippetUpdateInput.parse({ ...fields, archived: params.archived }) },
    );
    return jsonResult(`updated snippet ${updated.id}`, SnippetCompact.parse(updated));
  });
}

const segmentParameters = Type.Object({
  method: methodSchema,
  id: idParam,
  name: nameParam,
  table_id: tableIdParam,
  definition: definitionParam,
  description: descriptionParam,
  revision_message: revisionMessageParam,
  archived: archivedParam,
});

export function segmentWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "segment_write",
    label: "Write segment",
    description:
      `${readSkillsFirst(MBQL)}\n\n` +
      'Create or update a segment — a named filter on a table that questions reuse instead of re-stating the same conditions. Its `definition` is a single-stage MBQL 5 query holding only filters.\n\nExamples: `{method: "create", name: "Gadget orders", table_id: 9, definition: {"lib/type": "mbql/query", "database": 1, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": 9, "filters": [["=", {}, ["field", {}, 82], "Gadget"]]}]}}` · `{method: "update", id: 4, archived: true, revision_message: "Superseded by Widget orders"}`',
    parameters: segmentParameters,
    execute: (_id, params) => runSegmentWriteTool(deps, params),
  });
}

type SegmentWriteParams = Static<typeof segmentParameters>;

export function runSegmentWriteTool(
  deps: MetabaseToolDeps,
  params: SegmentWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertMethodRequirements(params.method, params, {
      create: ["name", "table_id", "definition"],
      update: ["id", "revision_message"],
    });

    if (params.method === "create") {
      const created = await deps.client.requestParsed(Segment, "/api/segment", {
        method: "POST",
        body: SegmentCreateInput.parse({
          name: params.name,
          table_id: params.table_id,
          definition: params.definition,
          description: params.description,
        }),
      });
      return entityResult(
        "segment",
        `created segment ${created.id}`,
        SegmentCompact.parse(created),
      );
    }

    const updated = await deps.client.requestParsed(Segment, `/api/segment/${String(params.id)}`, {
      method: "PUT",
      body: SegmentUpdateInput.parse({
        name: params.name,
        definition: params.definition,
        description: params.description,
        archived: params.archived,
        revision_message: params.revision_message,
      }),
    });
    return entityResult("segment", `updated segment ${updated.id}`, SegmentCompact.parse(updated));
  }, skillsAfterRejection(MBQL));
}

const measureParameters = Type.Object({
  method: methodSchema,
  id: idParam,
  name: nameParam,
  table_id: tableIdParam,
  definition: definitionParam,
  description: descriptionParam,
  revision_message: revisionMessageParam,
  archived: archivedParam,
});

export function measureWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "measure_write",
    label: "Write measure",
    description:
      `${readSkillsFirst(MBQL)}\n\n` +
      'Create or update a measure — a named aggregation attached to a table, which questions and models reuse as a column. A measure lives on a table; a metric is a standalone saved card (`question_write` with `card_type: "metric"`). Its `definition` is a single-stage MBQL 5 query holding the aggregation.\n\nExamples: `{method: "create", name: "Revenue", table_id: 9, definition: {"lib/type": "mbql/query", "database": 1, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": 9, "aggregation": [["sum", {}, ["field", {}, 88]]]}]}}` · `{method: "update", id: 2, name: "Net revenue", revision_message: "Exclude refunds"}`',
    parameters: measureParameters,
    execute: (_id, params) => runMeasureWriteTool(deps, params),
  });
}

type MeasureWriteParams = Static<typeof measureParameters>;

export function runMeasureWriteTool(
  deps: MetabaseToolDeps,
  params: MeasureWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertMethodRequirements(params.method, params, {
      create: ["name", "table_id", "definition"],
      update: ["id", "revision_message"],
    });

    if (params.method === "create") {
      const created = await deps.client.requestParsed(Measure, "/api/measure", {
        method: "POST",
        body: MeasureCreateInput.parse({
          name: params.name,
          table_id: params.table_id,
          definition: params.definition,
          description: params.description,
        }),
      });
      return jsonResult(`created measure ${created.id}`, MeasureCompact.parse(created));
    }

    const updated = await deps.client.requestParsed(Measure, `/api/measure/${String(params.id)}`, {
      method: "PUT",
      body: MeasureUpdateInput.parse({
        name: params.name,
        definition: params.definition,
        description: params.description,
        archived: params.archived,
        revision_message: params.revision_message,
      }),
    });
    return jsonResult(`updated measure ${updated.id}`, MeasureCompact.parse(updated));
  }, skillsAfterRejection(MBQL));
}

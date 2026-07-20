import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { clampRowLimit, ROW_LIMIT_DEFAULT, ROW_LIMIT_MAX, runDataset } from "./dataset";
import { readJsonFileInput } from "./file-input";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { resolveResponseFormat, responseFormatParam } from "./response-format";
import { readSkillsFirst, type SkillName, skillsAfterRejection } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { guardTool, type TextToolResult } from "./tool-result";

const MBQL: readonly SkillName[] = ["mbql"];

const parameters = Type.Object({
  query: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        'A staged MBQL 5 query object: `{"lib/type": "mbql/query", "database": <id>, "stages": [...]}`. Provide this or `query_file`, not both.',
    }),
  ),
  query_file: Type.Optional(
    Type.String({
      description:
        "Path to a file holding the MBQL 5 query as JSON. Keep a query you are iterating on in a file — edit it there, re-run it here, and save the identical file with `question_write`.",
    }),
  ),
  offset: Type.Optional(Type.Integer({ description: "Skip this many rows (continuation)." })),
  row_limit: Type.Optional(
    Type.Integer({
      description: `Max rows to return (default ${ROW_LIMIT_DEFAULT}, max ${ROW_LIMIT_MAX}).`,
    }),
  ),
  response_format: responseFormatParam,
});

export function executeQueryTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "execute_query",
    label: "Execute query",
    description:
      `${readSkillsFirst(MBQL)}\n\n` +
      'Run a structured MBQL 5 query and return rows in the dataset shape (`cols` + `rows`). MBQL 5 is `{"lib/type": "mbql/query", "database": <id>, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": <id>, ...}]}`; each stage feeds the next. Pass the query inline in `query`, or point `query_file` at a JSON file on disk — the file workflow lets you iterate with your editing tools and then save exactly what you ran by passing the same file to `question_write`. Page a large result by re-calling with the same query and an `offset`.\n\nExamples: `{query: {"lib/type": "mbql/query", "database": 1, "stages": [{"lib/type": "mbql.stage/mbql", "source-table": 2}]}}` · `{query_file: "revenue-by-month.mbql.json", row_limit: 200}`',
    parameters,
    execute: (_id, params) => runExecuteQueryTool(deps, params),
  });
}

type ExecuteQueryToolParams = Static<typeof parameters>;

export function runExecuteQueryTool(
  deps: MetabaseToolDeps,
  params: ExecuteQueryToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const datasetQuery = await resolveDatasetQuery(deps, params.query, params.query_file);
    return runDataset(deps, {
      datasetQuery,
      rowLimit: clampRowLimit(params.row_limit),
      offset: params.offset ?? 0,
      format: resolveResponseFormat(params.response_format),
      resubmit: "`query`",
    });
  }, skillsAfterRejection(MBQL));
}

async function resolveDatasetQuery(
  deps: MetabaseToolDeps,
  query: Record<string, unknown> | undefined,
  queryFile: string | undefined,
): Promise<JsonValue> {
  const hasQuery = query !== undefined;
  const hasFile = queryFile !== undefined && queryFile !== "";
  if (hasQuery === hasFile) {
    throw new TeachingError("Provide exactly one of `query` or `query_file`.");
  }
  if (hasFile) {
    return readJsonFileInput(deps.cwd, queryFile, "query_file");
  }
  return jsonValueSchema.parse(query);
}

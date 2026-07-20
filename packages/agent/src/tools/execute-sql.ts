import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import { clampRowLimit, ROW_LIMIT_DEFAULT, ROW_LIMIT_MAX, runDataset } from "./dataset";
import { readTextFileInput } from "./file-input";
import type { JsonValue } from "./json-value";
import { resolveResponseFormat, responseFormatParam } from "./response-format";
import { type SkillName, skillsAfterRejection } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { guardTool, type TextToolResult } from "./tool-result";

const NATIVE_SQL: readonly SkillName[] = ["native-sql"];

const TEMPLATE_TAG_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

type TagValue = string | number | boolean;

const parameters = Type.Object({
  database_id: Type.Integer({ description: "The database to run the SQL against." }),
  sql: Type.Optional(
    Type.String({
      description:
        "Raw SQL. Reference parameters as `{{tag_name}}` and pass their values in `template_tag_values`. Provide this or `sql_file`, not both.",
    }),
  ),
  sql_file: Type.Optional(
    Type.String({
      description:
        "Path to a .sql file on disk. Keep SQL you are iterating on in a file — edit it there, re-run it here, and save exactly what you ran by pointing `question_write`'s `native.sql_file` at the same file.",
    }),
  ),
  template_tag_values: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
      description:
        "Values for the `{{tag}}` placeholders in the SQL, keyed by tag name. Substituted through Metabase's template-tag mechanism, not driver-level prepared statements.",
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

export function executeSqlTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "execute_sql",
    label: "Execute SQL",
    description:
      'Run raw SQL against a database and return rows in the dataset shape (`cols` + `rows`). Pass the SQL inline in `sql`, or point `sql_file` at a file on disk — the file workflow lets you iterate with your editing tools and then save exactly what you ran via `question_write`\'s `native.sql_file`. Use `{{tag}}` placeholders with `template_tag_values` for parameters. Page a large result by re-calling with the same SQL and an `offset`.\n\nExamples: `{database_id: 1, sql: "SELECT count(*) FROM orders"}` · `{database_id: 1, sql_file: "monthly-revenue.sql"}` · `{database_id: 1, sql: "SELECT * FROM orders WHERE id = {{id}}", template_tag_values: {id: 42}}`',
    parameters,
    execute: (_id, params) => runExecuteSqlTool(deps, params),
  });
}

type ExecuteSqlToolParams = Static<typeof parameters>;

export function runExecuteSqlTool(
  deps: MetabaseToolDeps,
  params: ExecuteSqlToolParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    const sql = await resolveSql(deps, params.sql, params.sql_file);
    const values = params.template_tag_values ?? {};
    const tagNames = extractTagNames(sql);
    assertTagsDeclared(tagNames, values);
    const datasetQuery = buildNativeQuery(params.database_id, sql, tagNames, values);
    return runDataset(deps, {
      datasetQuery,
      rowLimit: clampRowLimit(params.row_limit),
      offset: params.offset ?? 0,
      format: resolveResponseFormat(params.response_format),
      resubmit: "`sql`",
    });
  }, skillsAfterRejection(NATIVE_SQL));
}

async function resolveSql(
  deps: MetabaseToolDeps,
  sql: string | undefined,
  sqlFile: string | undefined,
): Promise<string> {
  const hasSql = sql !== undefined && sql !== "";
  const hasFile = sqlFile !== undefined && sqlFile !== "";
  if (hasSql === hasFile) {
    throw new TeachingError("Provide exactly one of `sql` or `sql_file`.");
  }
  if (hasFile) {
    return readTextFileInput(deps.cwd, sqlFile, "sql_file");
  }
  if (sql === undefined) {
    throw new TeachingError("Provide exactly one of `sql` or `sql_file`.");
  }
  return sql;
}

function extractTagNames(sql: string): string[] {
  const names = new Set<string>();
  for (const match of sql.matchAll(TEMPLATE_TAG_PATTERN)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
}

function assertTagsDeclared(tagNames: string[], values: Record<string, TagValue>): void {
  const known = new Set(tagNames);
  const unknown = Object.keys(values).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new TeachingError(
      `template_tag_values names ${unknown.join(", ")} that don't appear as {{${unknown[0]}}} in the SQL. Add the placeholder or drop the value.`,
    );
  }
}

function buildNativeQuery(
  databaseId: number,
  sql: string,
  tagNames: string[],
  values: Record<string, TagValue>,
): JsonValue {
  const templateTags: { [name: string]: JsonValue } = {};
  const parametersList: JsonValue[] = [];
  for (const name of tagNames) {
    const value = values[name];
    const tagType = typeof value === "number" ? "number" : "text";
    templateTags[name] = { id: name, name, "display-name": name, type: tagType };
    if (value !== undefined) {
      parametersList.push({
        type: typeof value === "number" ? "number/=" : "category",
        target: ["variable", ["template-tag", name]],
        value: typeof value === "boolean" ? String(value) : value,
      });
    }
  }
  return {
    database: databaseId,
    type: "native",
    native: { query: sql, "template-tags": templateTags },
    parameters: parametersList,
  };
}

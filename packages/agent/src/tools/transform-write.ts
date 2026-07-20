import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Transform,
  TransformCompact,
  TransformCreateInput,
  TransformUpdateInput,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import { assertCapabilities, type ToolCapabilities } from "./capability";
import type { MetabaseToolDeps } from "./deps";
import { readJsonFileInput, readTextFileInput } from "./file-input";
import { writeJsonFileOutput, writeTextFileOutput } from "./file-output";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { buildNativeQuery, nativeQueryParts, tagOccurrences } from "./native-query";
import { readSkillsFirst, type SkillName, skillsAfterRejection } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { entityResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";
import { resolveTagIds } from "./transform-tags";
import { assertExactlyOneOf, assertMethodRequirements, missingFieldError } from "./write-recipe";

export const TRANSFORM_CAPABILITIES: ToolCapabilities = { minVersion: 59 };

const TOOL_NAME = "transform_write";
const SKILLS: readonly SkillName[] = ["transform", "mbql"];
const RUN_TRIGGERS = ["none", "global-schedule"] as const;
type RunTrigger = (typeof RUN_TRIGGERS)[number];

const TRANSFORM_METHODS = ["pull", "create", "update", "delete"] as const;
type TransformMethod = (typeof TRANSFORM_METHODS)[number];

const parameters = Type.Object({
  method: Type.Unsafe<TransformMethod>({
    type: "string",
    enum: [...TRANSFORM_METHODS],
    description:
      "`pull` writes the transform's saved source to a file for editing; `create` a new transform; `update` an existing one; `delete` one — permanent, with no trash behind it. Per-method required fields are named in each parameter's description; supplying the wrong set returns a teaching error naming the missing field.",
  }),
  id: Type.Optional(
    Type.Integer({ description: "Transform id. Required for `pull`, `update` and `delete`." }),
  ),
  name: Type.Optional(Type.String({ description: "Transform name. Required for `create`." })),
  description: Type.Optional(Type.String()),
  source: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        'What the transform reads and computes. A query source is `{"type": "query", "query": <MBQL 5 query>}` — the query may be MBQL or a native stage. A Python source is `{"type": "python", "body": "<python>", "source-tables": [{"alias": "orders", "database_id": 1, "schema": "public", "table": "orders"}]}`. Exactly one of `source`, `source_file`, `native` on `create`.',
    }),
  ),
  source_file: Type.Optional(
    Type.String({
      description:
        "Path to a JSON file holding the same `source` object — keep a Python body or a long query on disk instead of in this conversation. On `pull` the tool writes the saved source to this path instead: bare SQL when the source is plain SQL (default `transform-<id>.sql`), the `source` JSON otherwise (default `transform-<id>.source.json`).",
    }),
  ),
  native: Type.Optional(
    Type.Object(
      {
        database_id: Type.Integer(),
        sql: Type.Optional(Type.String()),
        sql_file: Type.Optional(
          Type.String({
            description:
              "Path to a .sql file — pass the same file you ran with `execute_sql` to materialize the byte-identical SQL. Provide `sql` or `sql_file`, not both.",
          }),
        ),
      },
      {
        description:
          "Sugar for a SQL transform: assembles the MBQL 5 native stage and wraps it as a query source. A transform's SQL takes no template tags — it runs unattended, with nothing to fill them in.",
      },
    ),
  ),
  target: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        'Where the result lands, as a warehouse table. Full refresh: `{"type": "table", "database": <id>, "schema": "public", "name": "orders_daily"}` — every run drops and rewrites the table. Incremental: `{"type": "table-incremental", …, "target-incremental-strategy": {"type": "append"}}` or `{"type": "merge", "unique-key": [{"name": "id"}]}`. Required for `create`.',
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Tag names. A tag binds this transform to the jobs that carry the same tag — that is how a transform gets scheduled. Names that do not exist yet are created. Passing `tags` replaces the transform's whole tag set.",
    }),
  ),
  collection_id: Type.Optional(
    Type.Integer({ description: "Collection to file the transform in." }),
  ),
  run_trigger: Type.Optional(
    Type.Unsafe<RunTrigger>({
      type: "string",
      enum: [...RUN_TRIGGERS],
      description:
        "`none` (default) runs only when triggered — by `transform_run`, or by a job whose tag it carries. `global-schedule` also runs it on the instance-wide transform schedule.",
    }),
  ),
  delete_target_table: Type.Optional(
    Type.Boolean({
      description:
        "`delete` only: also drop the materialized warehouse table the transform wrote. Default `false` — deleting a transform leaves its output table in place, and every question built on that table keeps working.",
    }),
  ),
});

export function transformWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    label: "Write transform",
    description:
      `${readSkillsFirst(SKILLS)}\n\n` +
      'Create, update, pull or delete a transform — a query Metabase runs on a schedule and materializes as a table in the warehouse, which questions and models then read like any other table. A transform is the tool for work that is too slow, too shared, or too multi-step to redo inside every question. To fix an existing transform, `{method: "pull", id}` writes its source to a file — edit it on disk, then `update` with the same path.\n\nExamples: `{method: "create", name: "Daily orders", native: {database_id: 1, sql: "SELECT date_trunc(\'day\', created_at) d, count(*) n FROM orders GROUP BY 1"}, target: {type: "table", database: 1, schema: "public", name: "daily_orders"}, tags: ["nightly"]}` · `{method: "pull", id: 4}` · `{method: "delete", id: 4, delete_target_table: true}`',
    parameters,
    execute: (_id, params) => runTransformWriteTool(deps, params),
  });
}

type TransformWriteParams = Static<typeof parameters>;

export function runTransformWriteTool(
  deps: MetabaseToolDeps,
  params: TransformWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertCapabilities(deps.instance, TRANSFORM_CAPABILITIES, TOOL_NAME);
    assertMethodRequirements(params.method, params, {
      pull: ["id"],
      create: ["name", "target"],
      update: ["id"],
      delete: ["id"],
    });

    if (params.method === "pull") {
      return await runTransformPull(deps, params);
    }
    if (params.method === "delete") {
      return await deleteTransform(deps, params);
    }

    const source = await resolveSource(deps, params);
    const tagIds =
      params.tags === undefined ? undefined : await resolveTagIds(deps.client, params.tags);
    const fields = {
      name: params.name,
      description: params.description,
      source,
      target: params.target,
      run_trigger: params.run_trigger,
      tag_ids: tagIds,
      collection_id: params.collection_id,
    };

    if (params.method === "create") {
      const created = await deps.client.requestParsed(Transform, "/api/transform", {
        method: "POST",
        body: TransformCreateInput.parse(fields),
      });
      return entityResult(
        "transform",
        `created transform ${String(created.id)} — nothing has run yet; \`transform_run\` materializes it`,
        TransformCompact.parse(created),
      );
    }

    const updated = await deps.client.requestParsed(
      Transform,
      `/api/transform/${String(params.id)}`,
      { method: "PUT", body: TransformUpdateInput.parse(fields) },
    );
    return entityResult(
      "transform",
      `updated transform ${String(updated.id)}`,
      TransformCompact.parse(updated),
    );
  }, skillsAfterRejection(SKILLS));
}

const PULLED_SOURCE_FILE = (id: number): string => `transform-${id}.source.json`;
const PULLED_SQL_FILE = (id: number): string => `transform-${id}.sql`;

async function runTransformPull(
  deps: MetabaseToolDeps,
  params: TransformWriteParams,
): Promise<TextToolResult> {
  const id = requireId(params);
  const transform = await deps.client.requestParsed(Transform, `/api/transform/${String(id)}`);
  const sql = plainSql(transform.source);
  if (sql !== null) {
    const file = await writeTextFileOutput(
      deps.cwd,
      params.source_file ?? PULLED_SQL_FILE(id),
      sql.sql,
    );
    return jsonResult(`pulled transform ${id} SQL to ${file}`, {
      file,
      database_id: sql.databaseId,
      note: `Edit the file, then apply it with {method: "update", id: ${id}, native: {database_id: ${sql.databaseId}, sql_file: "${file}"}}.`,
    });
  }

  const file = await writeJsonFileOutput(
    deps.cwd,
    params.source_file ?? PULLED_SOURCE_FILE(id),
    transform.source,
  );
  return jsonResult(`pulled transform ${id} source to ${file}`, {
    file,
    note: `Edit the file, then apply it with {method: "update", id: ${id}, source_file: "${file}"}.`,
  });
}

const PlainQuerySource = z.object({ type: z.literal("query"), query: z.unknown() }).strict();

interface PlainSqlSource {
  sql: string;
  databaseId: number;
}

// Only a source that is nothing but SQL can round-trip through `native.sql_file` — extra source
// keys (an incremental strategy), template tags, or stray {{...}} in the SQL would be dropped or
// rejected on the way back, so those sources pull as the whole `source` object instead.
function plainSql(source: unknown): PlainSqlSource | null {
  const parsed = PlainQuerySource.safeParse(source);
  if (!parsed.success) {
    return null;
  }
  const native = nativeQueryParts(parsed.data.query);
  if (native === null || Object.keys(native.templateTags).length > 0) {
    return null;
  }
  if (tagOccurrences(native.sql).size > 0) {
    return null;
  }
  return { sql: native.sql, databaseId: native.databaseId };
}

interface DeleteResult {
  id: number;
  deleted: true;
  target_table_dropped: boolean;
}

async function deleteTransform(
  deps: MetabaseToolDeps,
  params: TransformWriteParams,
): Promise<TextToolResult> {
  const id = requireId(params);
  const dropTable = params.delete_target_table === true;
  if (dropTable) {
    await deps.client.requestRaw(`/api/transform/${String(id)}/table`, {
      method: "DELETE",
      expectContentType: "binary",
    });
  }
  await deps.client.requestRaw(`/api/transform/${String(id)}`, {
    method: "DELETE",
    expectContentType: "binary",
  });
  const result: DeleteResult = { id, deleted: true, target_table_dropped: dropTable };
  const label = dropTable
    ? `deleted transform ${String(id)} and dropped its output table`
    : `deleted transform ${String(id)} — its materialized output table still stands, and anything reading it keeps working. Pass \`delete_target_table: true\` to drop the table too.`;
  return jsonResult(label, result);
}

async function resolveSource(
  deps: MetabaseToolDeps,
  params: TransformWriteParams,
): Promise<JsonValue | undefined> {
  const sources = ["source", "source_file", "native"] as const;
  const provided = sources.filter((key) => params[key] !== undefined);
  if (params.method === "create" || provided.length > 0) {
    assertExactlyOneOf(params, sources, "source");
  }

  if (params.source !== undefined) {
    return jsonValueSchema.parse(params.source);
  }
  if (params.source_file !== undefined) {
    return await readJsonFileInput(deps.cwd, params.source_file, "source_file");
  }
  if (params.native !== undefined) {
    const sql = await resolveNativeSql(deps, params.native);
    return {
      type: "query",
      query: buildNativeQuery({ database_id: params.native.database_id, sql }),
    };
  }
  return undefined;
}

type NativeSource = NonNullable<TransformWriteParams["native"]>;

async function resolveNativeSql(deps: MetabaseToolDeps, native: NativeSource): Promise<string> {
  assertExactlyOneOf(native, ["sql", "sql_file"], "native SQL source");
  if (native.sql !== undefined) {
    return native.sql;
  }
  if (native.sql_file !== undefined) {
    return await readTextFileInput(deps.cwd, native.sql_file, "native.sql_file");
  }
  throw new TeachingError("native needs `sql` or `sql_file`.");
}

function requireId(params: TransformWriteParams): number {
  if (params.id === undefined) {
    throw missingFieldError(params.method, ["id"], params);
  }
  return params.id;
}

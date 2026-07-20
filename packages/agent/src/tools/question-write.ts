import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Client } from "@metabase/cli/client";
import {
  Card,
  CardCompact,
  CardCreateInput,
  CardUpdateInput,
  FieldSemanticType,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import type { MetabaseToolDeps } from "./deps";
import { readJsonFileInput, readTextFileInput } from "./file-input";
import { writeJsonFileOutput, writeTextFileOutput } from "./file-output";
import { type JsonValue, jsonValueSchema } from "./json-value";
import { buildNativeQuery, type NativeQueryParts, nativeQueryParts } from "./native-query";
import { type SkillName, skillsAfterRejection } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import { entityResult, guardTool, jsonResult, type TextToolResult } from "./tool-result";
import { assertExactlyOneOf, assertMethodRequirements, missingFieldError } from "./write-recipe";

const MBQL: readonly SkillName[] = ["mbql"];
const NATIVE_SQL: readonly SkillName[] = ["native-sql"];

const CARD_TYPES = ["question", "model", "metric"] as const;
type CardType = (typeof CARD_TYPES)[number];

const QUESTION_METHODS = ["pull", "create", "update"] as const;
type QuestionMethod = (typeof QUESTION_METHODS)[number];

const DEFAULT_DISPLAY = "table";

const parameters = Type.Object({
  method: Type.Unsafe<QuestionMethod>({
    type: "string",
    enum: [...QUESTION_METHODS],
    description:
      "`pull` writes the card's saved query to a file for editing; `create` a new card; `update` an existing one. Per-method required fields are named in each parameter's description; supplying the wrong set returns a teaching error naming the missing field.",
  }),
  id: Type.Optional(Type.Integer({ description: "Card id. Required for `pull` and `update`." })),
  card_type: Type.Optional(
    Type.Unsafe<CardType>({
      type: "string",
      enum: [...CARD_TYPES],
      description:
        "`question` (default) is a saved query; `model` is a curated, reusable table other questions start from; `metric` is a saved aggregation other questions reference. A metric's query takes exactly one aggregation and at most one time grouping.",
    }),
  ),
  name: Type.Optional(Type.String({ description: "Card title. Required for `create`." })),
  description: Type.Optional(Type.String()),
  query: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        'A staged MBQL 5 query: `{"lib/type": "mbql/query", "database": <id>, "stages": [...]}`.',
    }),
  ),
  query_file: Type.Optional(
    Type.String({
      description:
        "Path to a file holding the MBQL 5 query as JSON — pass the same file you ran with `execute_query` to save the byte-identical query. On `pull` the tool writes the card's saved query to this path instead: JSON for a structured card (default `card-<id>.query.json`), bare SQL for a native one (default `card-<id>.sql`).",
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
              "Path to a .sql file — pass the same file you ran with `execute_sql` to save the byte-identical SQL. Provide `sql` or `sql_file`, not both.",
          }),
        ),
        template_tags: Type.Optional(
          Type.Unsafe<Record<string, unknown>>({
            type: "object",
            additionalProperties: true,
            description:
              'One entry per `{{tag}}` in the SQL, keyed by the tag name. A bare `{{x}}` filtering a real column is a field filter (`{"type": "dimension", "dimension": ["field", {}, <field-id>], "widget-type": "string/="}`); anything spliced into an expression is a raw variable (`{"type": "text" | "number" | "date" | "boolean"}`). Ids are minted for you.',
          }),
        ),
      },
      {
        description:
          "A raw SQL query. Reach for it only when a structured `query` can't express the question.",
      },
    ),
  ),
  collection_id: Type.Optional(
    Type.Integer({
      description:
        "Collection to save into. Omit for the root collection; set it to move the card.",
    }),
  ),
  dashboard_id: Type.Optional(
    Type.Integer({
      description:
        "Save the card inside a dashboard instead of a collection — it then belongs to that dashboard and is not reusable elsewhere.",
    }),
  ),
  collection_position: Type.Optional(
    Type.Integer({ description: "Pins the card at the top of its collection." }),
  ),
  display: Type.Optional(
    Type.String({
      description: `Visualization: table, bar, line, area, pie, scalar, row, funnel, map, … A top-level argument, never a \`visualization_settings\` key. Set it in the \`create\` that saves the query; defaults to \`${DEFAULT_DISPLAY}\` when omitted.`,
    }),
  ),
  visualization_settings: Type.Optional(
    Type.Unsafe<Record<string, unknown>>({
      type: "object",
      additionalProperties: true,
      description:
        "Chart settings (axis titles, column formatting, series colors), keyed per the chosen `display` (`graph.*`, `pie.*`, …). Card fields like `display` and `name` are top-level arguments and are rejected here. Defaults to `{}`.",
    }),
  ),
  column_metadata: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        display_name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        semantic_type: Type.Optional(Type.String()),
        visibility_type: Type.Optional(Type.String()),
      }),
      {
        description:
          "Model column curation, merged by column `name` over the model's computed metadata. Only valid when `card_type` is `model`.",
      },
    ),
  ),
  archived: Type.Optional(
    Type.Boolean({
      description: "`update` only: `true` sends the card to the trash, `false` restores it.",
    }),
  ),
});

export function questionWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "question_write",
    label: "Write question",
    description:
      "Read the `mbql` skill before composing a `query`, the `native-sql` skill before declaring `native.template_tags`, and the `visualization` skill before setting `display` or `visualization_settings`. The exact shapes are not guessable: a body assembled from intuition gets rejected by the server, not repaired by it.\n\n" +
      'Create, update, or pull a question, model, or metric. The query comes from exactly one source: plain MBQL 5 in `query`, a `query_file` on disk, or `native` SQL (inline `sql` or an `sql_file`). To save exactly what you just ran, point the same file you executed at this tool. `display` and `visualization_settings` are saved with the card — set them in the `create`, not in a follow-up `update`; a create that omits them makes a plain table. To edit an existing card\'s query, `{method: "pull", id}` writes it to a file — edit it on disk, re-run it with `execute_query`/`execute_sql`, then `update` with the same path. `collection_id` moves the card between collections and `collection_position` pins it at the top of one; `archived: true` trashes it and `archived: false` restores it.\n\nExamples: `{method: "create", name: "Revenue by month", query_file: "revenue-by-month.mbql.json", display: "line"}` · `{method: "create", name: "Active users", card_type: "model", native: {database_id: 1, sql: "SELECT * FROM users WHERE {{state}}", template_tags: {state: {type: "dimension", dimension: ["field", {}, 1779], "widget-type": "string/="}}}}` · `{method: "pull", id: 42}` · `{method: "update", id: 42, collection_id: 7, collection_position: 1}`',
    parameters,
    execute: (_id, params) => runQuestionWriteTool(deps, params),
  });
}

type QuestionWriteParams = Static<typeof parameters>;

const QUERY_SOURCES = ["query", "query_file", "native"] as const;

function rejectionFix(params: QuestionWriteParams): string {
  return skillsAfterRejection(params.native === undefined ? MBQL : NATIVE_SQL);
}

export function runQuestionWriteTool(
  deps: MetabaseToolDeps,
  params: QuestionWriteParams,
): Promise<TextToolResult> {
  return guardTool(async () => {
    assertMethodRequirements(params.method, params, {
      pull: ["id"],
      create: ["name"],
      update: ["id"],
    });
    if (params.method === "pull") {
      return await runQuestionPull(deps, params);
    }
    if (params.method === "create") {
      assertExactlyOneOf(params, QUERY_SOURCES, "query source");
    } else {
      assertAtMostOneSource(params);
    }
    assertSettingsAreOnlySettings(params);
    if (params.collection_id !== undefined && params.dashboard_id !== undefined) {
      throw new TeachingError(
        "A card is saved either in a collection (`collection_id`) or inside a dashboard (`dashboard_id`), not both.",
      );
    }

    const cardType = params.card_type ?? "question";
    const datasetQuery = await resolveDatasetQuery(deps, params);
    if (datasetQuery !== null && cardType === "metric") {
      assertMetricShape(datasetQuery);
    }
    const declaredType = params.method === "create" ? cardType : params.card_type;
    if (
      params.column_metadata !== undefined &&
      declaredType !== undefined &&
      declaredType !== "model"
    ) {
      throw new TeachingError(
        `column_metadata curates a model's columns — this card is a ${declaredType}. Set \`card_type: "model"\` or drop \`column_metadata\`.`,
      );
    }

    const written = await writeCard(deps.client, params, cardType, datasetQuery);
    const curated = await applyColumnMetadata(deps.client, written, params.column_metadata);
    return entityResult(
      "question",
      `${params.method}d question ${curated.id}`,
      CardCompact.parse(curated),
    );
  }, rejectionFix(params));
}

// Nothing server-side validates visualization_settings: a card field smuggled in there is stored,
// never read, and the card renders as the default table — a silent miss that costs a second write.
const CARD_ARGUMENTS_MISPLACED_IN_SETTINGS = [
  "display",
  "name",
  "description",
  "card_type",
  "collection_id",
] as const;

function assertSettingsAreOnlySettings(params: QuestionWriteParams): void {
  const settings = params.visualization_settings;
  if (settings === undefined) {
    return;
  }
  const misplaced = CARD_ARGUMENTS_MISPLACED_IN_SETTINGS.filter((key) => key in settings);
  if (misplaced.length === 0) {
    return;
  }
  const names = misplaced.map((key) => `\`${key}\``).join(", ");
  const subject = misplaced.length === 1 ? "is a top-level argument" : "are top-level arguments";
  throw new TeachingError(
    `${names} ${subject} of this tool, not a \`visualization_settings\` key — the server stores stray keys without reading them and the card renders as the default table. Move it up a level: \`{method: "create", name, query_file, display: "bar", visualization_settings: {"graph.dimensions": [...], "graph.metrics": [...]}}\`.`,
  );
}

function assertAtMostOneSource(params: QuestionWriteParams): void {
  const provided = QUERY_SOURCES.filter((key) => params[key] !== undefined);
  if (provided.length > 1) {
    throw new TeachingError(
      `Provide at most one query source (${QUERY_SOURCES.join(", ")}); received ${provided.length}.`,
    );
  }
}

const PULLED_QUERY_FILE = (id: number): string => `card-${id}.query.json`;
const PULLED_SQL_FILE = (id: number): string => `card-${id}.sql`;

async function runQuestionPull(
  deps: MetabaseToolDeps,
  params: QuestionWriteParams,
): Promise<TextToolResult> {
  const id = requireId(params);
  const card = await deps.client.requestParsed(Card, `/api/card/${id}`);
  const native = nativeQueryParts(card.dataset_query);
  if (native !== null) {
    return pullNative(deps, params, id, card.type, native);
  }

  const datasetQuery = pullableDatasetQuery(id, card.dataset_query);
  const file = await writeJsonFileOutput(
    deps.cwd,
    params.query_file ?? PULLED_QUERY_FILE(id),
    datasetQuery,
  );
  return jsonResult(`pulled ${card.type} ${id} query to ${file}`, {
    file,
    note: `Edit the file, then apply it with {method: "update", id: ${id}, query_file: "${file}"}.`,
  });
}

async function pullNative(
  deps: MetabaseToolDeps,
  params: QuestionWriteParams,
  id: number,
  cardType: string,
  native: NativeQueryParts,
): Promise<TextToolResult> {
  const file = await writeTextFileOutput(
    deps.cwd,
    params.query_file ?? PULLED_SQL_FILE(id),
    native.sql,
  );
  const hasTags = Object.keys(native.templateTags).length > 0;
  const tagArgument = hasTags ? ", template_tags: <the template_tags returned here>" : "";
  return jsonResult(`pulled ${cardType} ${id} SQL to ${file}`, {
    file,
    database_id: native.databaseId,
    ...(hasTags ? { template_tags: native.templateTags } : {}),
    note:
      `Edit the file, then apply it with {method: "update", id: ${id}, native: {database_id: ${native.databaseId}, sql_file: "${file}"${tagArgument}}}.` +
      (hasTags
        ? " Pass `template_tags` through unchanged (edited only to match SQL edits) so the card keeps its tag definitions."
        : ""),
  });
}

function pullableDatasetQuery(id: number, datasetQuery: unknown): JsonValue {
  const parsed = jsonValueSchema.parse(datasetQuery ?? null);
  const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  if (!isObject || Object.keys(parsed).length === 0) {
    throw new TeachingError(`Card ${id} has no saved query to pull.`);
  }
  return parsed;
}

function requireId(params: QuestionWriteParams): number {
  if (params.id === undefined) {
    throw missingFieldError(params.method, ["id"], params);
  }
  return params.id;
}

async function resolveDatasetQuery(
  deps: MetabaseToolDeps,
  params: QuestionWriteParams,
): Promise<JsonValue | null> {
  if (params.native !== undefined) {
    const sql = await resolveNativeSql(deps, params.native);
    return buildNativeQuery({
      database_id: params.native.database_id,
      sql,
      template_tags: params.native.template_tags,
    });
  }
  if (params.query_file !== undefined) {
    return readJsonFileInput(deps.cwd, params.query_file, "query_file");
  }
  if (params.query !== undefined) {
    return jsonValueSchema.parse(params.query);
  }
  return null;
}

interface NativeParams {
  sql?: string | undefined;
  sql_file?: string | undefined;
}

async function resolveNativeSql(deps: MetabaseToolDeps, native: NativeParams): Promise<string> {
  const hasSql = native.sql !== undefined && native.sql !== "";
  const hasFile = native.sql_file !== undefined && native.sql_file !== "";
  if (hasSql === hasFile) {
    throw new TeachingError("Provide exactly one of `native.sql` or `native.sql_file`.");
  }
  if (hasFile && native.sql_file !== undefined) {
    return readTextFileInput(deps.cwd, native.sql_file, "native.sql_file");
  }
  if (native.sql === undefined) {
    throw new TeachingError("Provide exactly one of `native.sql` or `native.sql_file`.");
  }
  return native.sql;
}

async function writeCard(
  client: Client,
  params: QuestionWriteParams,
  cardType: CardType,
  datasetQuery: JsonValue | null,
): Promise<Card> {
  const shared = {
    name: params.name,
    description: params.description,
    collection_id: params.collection_id,
    dashboard_id: params.dashboard_id,
    collection_position: params.collection_position,
    visualization_settings: params.visualization_settings,
  };

  if (params.method === "create") {
    const body = CardCreateInput.parse({
      ...shared,
      type: cardType,
      dataset_query: datasetQuery,
      display: params.display ?? DEFAULT_DISPLAY,
      visualization_settings: params.visualization_settings ?? {},
    });
    return client.requestParsed(Card, "/api/card", { method: "POST", body });
  }

  // Sending `type` on every update would silently convert a model back into a question, so it
  // rides along only when the caller asked for the conversion.
  const body = CardUpdateInput.parse({
    ...shared,
    ...(params.card_type === undefined ? {} : { type: params.card_type }),
    ...(datasetQuery === null ? {} : { dataset_query: datasetQuery }),
    display: params.display,
    archived: params.archived,
  });
  return client.requestParsed(Card, `/api/card/${String(params.id)}`, { method: "PUT", body });
}

const ColumnMetadata = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    semantic_type: FieldSemanticType.optional(),
    visibility_type: z.string().optional(),
  })
  .strip();
type ColumnMetadata = z.infer<typeof ColumnMetadata>;

const ResultMetadata = z.array(z.object({ name: z.string() }).loose());
const CardResultMetadata = z.object({ result_metadata: ResultMetadata.nullish() }).loose();

async function applyColumnMetadata(
  client: Client,
  card: Card,
  columns: QuestionWriteParams["column_metadata"],
): Promise<Card> {
  if (columns === undefined || columns.length === 0) {
    return card;
  }
  if (card.type !== "model") {
    throw new TeachingError(
      `column_metadata curates a model's columns — card ${card.id} is a ${card.type}. Set \`card_type: "model"\` or drop \`column_metadata\`.`,
    );
  }
  const computed = CardResultMetadata.parse(card).result_metadata ?? [];
  const known = new Set(computed.map((column) => column.name));
  const overrides = new Map<string, ColumnMetadata>();
  for (const column of columns) {
    const parsed = ColumnMetadata.parse(column);
    if (!known.has(parsed.name)) {
      throw new TeachingError(
        `Model ${card.id} has no column "${parsed.name}" — its columns are ${[...known].map((name) => `"${name}"`).join(", ")}.`,
      );
    }
    overrides.set(parsed.name, parsed);
  }

  const merged: unknown[] = [];
  for (const column of computed) {
    const override = overrides.get(column.name);
    merged.push(override === undefined ? column : { ...column, ...override });
  }
  const body = CardUpdateInput.parse({ result_metadata: merged });
  return client.requestParsed(Card, `/api/card/${card.id}`, { method: "PUT", body });
}

const MetricStage = z
  .object({
    aggregation: z.array(z.unknown()).nullish(),
    breakout: z.array(z.unknown()).nullish(),
  })
  .loose();
const MetricQuery = z.object({ stages: z.array(MetricStage).min(1) }).loose();
const TemporalRef = z
  .tuple([z.string(), z.object({ "temporal-unit": z.string() }).loose()])
  .rest(z.unknown());

function assertMetricShape(datasetQuery: JsonValue): void {
  const parsed = MetricQuery.safeParse(datasetQuery);
  if (!parsed.success) {
    return;
  }
  const stage = parsed.data.stages.at(-1);
  if (stage === undefined) {
    return;
  }
  const aggregations = stage.aggregation ?? [];
  if (aggregations.length !== 1) {
    throw new TeachingError(
      `A metric holds exactly one aggregation; this query's last stage has ${aggregations.length}. Split the extras into their own metrics, or save this as a question.`,
    );
  }
  const temporal = (stage.breakout ?? []).filter(
    (ref) => TemporalRef.safeParse(ref).success,
  ).length;
  if (temporal > 1) {
    throw new TeachingError(
      `A metric takes at most one time grouping; this query's last stage breaks out by ${temporal}. Drop the extras — a question reading the metric can group it further.`,
    );
  }
}

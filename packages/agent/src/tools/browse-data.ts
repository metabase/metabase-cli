import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Database,
  DatabaseCompact,
  Field,
  FieldCompact,
  SearchResult,
  Table,
  TableCompact,
  TableQueryMetadata,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import { z } from "zod";
import type { MetabaseToolDeps } from "./deps";
import { type BudgetUnit, buildListEnvelope, packUnits } from "./envelope";
import type { PayloadSection } from "./payload";
import { type ResponseFormat, resolveResponseFormat, responseFormatParam } from "./response-format";
import { TeachingError } from "./teaching-error";
import {
  errorMessageOf,
  guardTool,
  jsonResult,
  listResult,
  sectionsResult,
  type TextToolResult,
} from "./tool-result";

const ACTIONS = [
  "list_databases",
  "list_schemas",
  "list_tables",
  "list_models",
  "get_fields",
] as const;
type Action = (typeof ACTIONS)[number];

const DatabaseListEnvelope = z
  .object({ data: z.array(Database), total: z.number().int().nonnegative() })
  .loose();
const SearchEnvelope = z
  .object({ data: z.array(SearchResult), total: z.number().int().nonnegative() })
  .loose();
const SchemaNames = z.array(z.string());
const TableArray = z.array(Table);

const SearchResultConcise = SearchResult.pick({
  id: true,
  name: true,
  model: true,
  description: true,
}).strip();

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`list_databases` · `list_schemas` (needs `database_id`) · `list_tables` (needs `database_id`, optional `schema`) · `list_models` (needs `database_id`) · `get_fields` (needs `table_ids`).",
  }),
  database_id: Type.Optional(
    Type.Integer({
      description: "Database id — required for list_schemas, list_tables, list_models.",
    }),
  ),
  schema: Type.Optional(
    Type.String({ description: "Schema name — narrows list_tables to one schema." }),
  ),
  table_ids: Type.Optional(
    Type.Array(Type.Integer(), {
      description: "Table ids to fetch fields for — required for get_fields.",
    }),
  ),
  offset: Type.Optional(
    Type.Integer({
      description:
        "get_fields only: skip this many fields of a single over-budget table (continuation).",
    }),
  ),
  response_format: responseFormatParam,
});

export function browseDataTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "browse_data",
    label: "Browse data",
    description:
      'Walk the data hierarchy under a named `action`: `list_databases`, `list_schemas`, `list_tables`, `list_models`, `get_fields`. `get_fields` takes a batch of `table_ids` and isolates faults per table — one bad id fails that table, not the batch.\n\nExamples: `{action: "list_tables", database_id: 1, schema: "public"}` · `{action: "get_fields", table_ids: [9, 12]}`',
    parameters,
    execute: (_id, params) => runBrowseDataTool(deps, params),
  });
}

type BrowseDataToolParams = Static<typeof parameters>;

export function runBrowseDataTool(
  deps: MetabaseToolDeps,
  params: BrowseDataToolParams,
): Promise<TextToolResult> {
  return guardTool(() => run(deps, params, resolveResponseFormat(params.response_format)));
}

interface BrowseParams {
  action: Action;
  database_id?: number;
  schema?: string;
  table_ids?: number[];
  offset?: number;
}

async function run(
  deps: MetabaseToolDeps,
  params: BrowseParams,
  format: ResponseFormat,
): Promise<TextToolResult> {
  switch (params.action) {
    case "list_databases": {
      return listDatabases(deps, format);
    }
    case "list_schemas": {
      return listSchemas(deps, requireDatabaseId(params));
    }
    case "list_tables": {
      return listTables(deps, requireDatabaseId(params), params.schema, format);
    }
    case "list_models": {
      return listModels(deps, requireDatabaseId(params));
    }
    case "get_fields": {
      return getFields(deps, requireTableIds(params), params.offset ?? 0, format);
    }
  }
}

async function listDatabases(
  deps: MetabaseToolDeps,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const response = await deps.client.requestParsed(DatabaseListEnvelope, "/api/database");
  const items = response.data.map((db) => (format === "detailed" ? db : DatabaseCompact.parse(db)));
  const envelope = buildListEnvelope(items, {
    total: response.total,
    steering: { noun: "databases" },
  });
  return listResult("databases", envelope, format);
}

async function listSchemas(deps: MetabaseToolDeps, databaseId: number): Promise<TextToolResult> {
  const names = await deps.client.requestParsed(SchemaNames, `/api/database/${databaseId}/schemas`);
  const items = names.map((name) => ({ name }));
  const envelope = buildListEnvelope(items, {
    total: items.length,
    steering: { noun: "schemas" },
  });
  return listResult("schemas", envelope, "concise");
}

async function listTables(
  deps: MetabaseToolDeps,
  databaseId: number,
  schema: string | undefined,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const tables = await fetchTables(deps, databaseId, schema);
  const items = tables.map((table) => (format === "detailed" ? table : TableCompact.parse(table)));
  const context = schema === undefined ? `in database ${databaseId}` : `in schema \`${schema}\``;
  const envelope = buildListEnvelope(items, {
    total: items.length,
    steering: { noun: "tables", context, narrowWith: ["schema"], pageWith: "offset" },
  });
  return listResult("tables", envelope, format);
}

async function fetchTables(
  deps: MetabaseToolDeps,
  databaseId: number,
  schema: string | undefined,
): Promise<Table[]> {
  if (schema !== undefined) {
    return deps.client.requestParsed(
      TableArray,
      `/api/database/${databaseId}/schema/${encodeURIComponent(schema)}`,
    );
  }
  const database = await deps.client.requestParsed(
    Database,
    `/api/database/${databaseId}/metadata`,
    {
      query: { skip_fields: true },
    },
  );
  return database.tables ?? [];
}

async function listModels(deps: MetabaseToolDeps, databaseId: number): Promise<TextToolResult> {
  const response = await deps.client.requestParsed(SearchEnvelope, "/api/search", {
    query: { models: ["dataset"], table_db_id: databaseId },
  });
  const items = response.data.map((item) => SearchResultConcise.parse(item));
  const envelope = buildListEnvelope(items, {
    total: response.total,
    steering: { noun: "models", context: `in database ${databaseId}` },
  });
  return listResult("models", envelope, "concise");
}

interface FieldsUnit extends BudgetUnit<unknown> {
  table_id: number;
  name: string;
  db_id: number;
  schema: string | null;
}

interface FieldsError {
  table_id: number;
  error: string;
}

async function getFields(
  deps: MetabaseToolDeps,
  tableIds: number[],
  offset: number,
  format: ResponseFormat,
): Promise<TextToolResult> {
  const units: FieldsUnit[] = [];
  const errors: FieldsError[] = [];
  for (const tableId of tableIds) {
    try {
      const table = await deps.client.requestParsed(
        TableQueryMetadata,
        `/api/table/${tableId}/query_metadata`,
      );
      const fields = table.fields.map((field) => projectField(field, format));
      units.push({
        key: String(tableId),
        table_id: tableId,
        name: table.name,
        db_id: table.db_id,
        schema: table.schema,
        items: fields,
      });
    } catch (error) {
      errors.push({ table_id: tableId, error: errorMessageOf(error) });
    }
  }

  const { included, omittedKeys } = packUnits(units, { startOffset: offset });
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  const sections: PayloadSection[] = [];
  for (const packed of included) {
    const unit = byKey.get(packed.key);
    if (unit === undefined) {
      continue;
    }
    const sliced = packed.items.length < packed.total;
    const section: PayloadSection = {
      title: sectionTitle(unit),
      items: packed.items,
    };
    if (sliced) {
      section.notice = `${packed.items.length} of ${packed.total} fields — continue with get_fields(table_ids: [${unit.table_id}], offset: ${packed.offset + packed.items.length})`;
    }
    sections.push(section);
  }

  const notices: string[] = [];
  for (const key of omittedKeys) {
    const unit = byKey.get(key);
    if (unit !== undefined) {
      notices.push(
        `${unit.name} (table ${unit.table_id}) omitted for space — request it separately with get_fields(table_ids: [${unit.table_id}])`,
      );
    }
  }
  for (const failure of errors) {
    notices.push(`table ${failure.table_id}: ${failure.error}`);
  }

  if (format === "detailed") {
    return jsonResult(`fields for ${sections.length} tables`, { sections, notices });
  }
  return sectionsResult("fields", sections, notices);
}

function sectionTitle(unit: FieldsUnit): string {
  const location = [`table ${unit.table_id}`, `database ${unit.db_id}`];
  if (unit.schema !== null) {
    location.push(`schema ${unit.schema}`);
  }
  return `${unit.name} (${location.join(", ")})`;
}

function projectField(field: Field, format: ResponseFormat): unknown {
  return format === "detailed" ? field : FieldCompact.parse(field);
}

function requireDatabaseId(params: BrowseParams): number {
  if (params.database_id === undefined) {
    throw new TeachingError(`\`database_id\` is required for action \`${params.action}\`.`);
  }
  return params.database_id;
}

function requireTableIds(params: BrowseParams): number[] {
  if (params.table_ids === undefined || params.table_ids.length === 0) {
    throw new TeachingError(
      "`table_ids` is required for action `get_fields` — pass one or more table ids.",
    );
  }
  return params.table_ids;
}

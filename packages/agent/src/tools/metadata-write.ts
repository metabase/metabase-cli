import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Database,
  DatabaseTaskAck,
  Field,
  FieldCompact,
  FieldUpdateInput,
  Table,
  TableCompact,
  TableUpdateInput,
} from "@metabase/cli/domain";
import { type Static, Type } from "typebox";
import type { MetabaseToolDeps } from "./deps";
import type { PayloadSection } from "./payload";
import { pollUntil, resolveTimeoutMs, resolveWait, timeoutMsParam, waitParam } from "./poll";
import { readSkillsFirst, type SkillName, skillsAfterRejection } from "./skill-prereq";
import { TeachingError } from "./teaching-error";
import {
  errorMessageOf,
  guardTool,
  jsonResult,
  sectionsResult,
  type TextToolResult,
} from "./tool-result";

const SKILLS: readonly SkillName[] = ["metadata"];
const SYNC_COMPLETE = "complete";

const ACTIONS = ["update_table", "update_field", "sync_schema", "rescan_values"] as const;
type Action = (typeof ACTIONS)[number];

const fieldEdit = Type.Object({
  field_id: Type.Integer(),
  display_name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  semantic_type: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description:
        "What the column *means*, as a `type/…` tag — `type/Email`, `type/Category`, `type/Currency`, `type/FK`, `type/PK`, `type/CreationTimestamp`, … It drives how Metabase filters, formats and charts the column. `null` clears it. An unrecognized tag is rejected with the legal values named.",
    }),
  ),
  fk_target_field_id: Type.Optional(
    Type.Union([Type.Integer(), Type.Null()], {
      description:
        'The primary-key field this column points at. Set `semantic_type: "type/FK"` in the same edit — a foreign key without a target is not joinable.',
    }),
  ),
  visibility_type: Type.Optional(
    Type.String({
      description:
        "`normal` · `details-only` (hidden from tables, shown on a record's detail view) · `sensitive` (hidden everywhere, and unqueryable) · `hidden` · `retired`.",
    }),
  ),
  has_field_values: Type.Optional(
    Type.String({
      description:
        "How filter widgets offer this column's values: `list` (a dropdown of cached values) · `search` (a search box) · `none` (a plain input) · `auto-list`.",
    }),
  ),
  coercion_strategy: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description:
        'Reinterpret the stored type, e.g. `"Coercion/UNIXSeconds->DateTime"` for an epoch column stored as an integer.',
    }),
  ),
});

const parameters = Type.Object({
  action: Type.Unsafe<Action>({
    type: "string",
    enum: [...ACTIONS],
    description:
      "`update_table` (needs `table_id` and `table`) · `update_field` (needs `fields`) · `sync_schema` (needs `database_id`) re-reads the warehouse's schema so new tables and columns appear · `rescan_values` (needs `database_id`) refreshes the cached distinct values behind filter dropdowns.",
  }),
  table_id: Type.Optional(Type.Integer({ description: "Table id — required for `update_table`." })),
  database_id: Type.Optional(
    Type.Integer({ description: "Database id — required for `sync_schema` and `rescan_values`." }),
  ),
  table: Type.Optional(
    Type.Object(
      {
        display_name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        visibility_type: Type.Optional(
          Type.Union([Type.String(), Type.Null()], {
            description:
              "`null` shows the table in the query builder; `hidden`, `technical` or `cruft` take it out of the picker without touching the data.",
          }),
        ),
        entity_type: Type.Optional(
          Type.Union([Type.String(), Type.Null()], {
            description:
              'What the table holds, e.g. `"entity/UserTable"`, `"entity/TransactionTable"`, `"entity/ProductTable"`, `"entity/EventTable"`, `"entity/GenericTable"`.',
          }),
        ),
        field_order: Type.Optional(
          Type.String({
            description: "`database` · `alphabetical` · `custom` · `smart`.",
          }),
        ),
      },
      { description: "The table's edits. Required for `update_table`." },
    ),
  ),
  fields: Type.Optional(
    Type.Array(fieldEdit, {
      description:
        "One entry per column to edit — required for `update_field`. Curating six columns is one call, not six: each entry is applied independently, and one bad `field_id` or unknown `semantic_type` names itself in a notice instead of failing the others.",
    }),
  ),
  wait: waitParam,
  timeout_ms: timeoutMsParam,
});

export function metadataWriteTool(deps: MetabaseToolDeps): ToolDefinition {
  return defineTool({
    name: "metadata_write",
    label: "Write metadata",
    description:
      `${readSkillsFirst(SKILLS)}\n\n` +
      'Curate the data model: what a table and its columns are called, what they mean, which are visible, and how they join — plus the two syncs that keep Metabase\'s picture of the warehouse current. This metadata is what every question, chart and filter reads, so an unlabelled `cust_id_2` column stays unlabelled in every question built on it until it is fixed here.\n\nExamples: `{action: "update_field", fields: [{field_id: 88, semantic_type: "type/Email"}, {field_id: 91, semantic_type: "type/FK", fk_target_field_id: 12}]}` · `{action: "sync_schema", database_id: 1}`',
    parameters,
    execute: (_id, params) => runMetadataWriteTool(deps, params),
  });
}

type MetadataWriteParams = Static<typeof parameters>;

export function runMetadataWriteTool(
  deps: MetabaseToolDeps,
  params: MetadataWriteParams,
): Promise<TextToolResult> {
  return guardTool(() => run(deps, params), skillsAfterRejection(SKILLS));
}

async function run(deps: MetabaseToolDeps, params: MetadataWriteParams): Promise<TextToolResult> {
  switch (params.action) {
    case "update_table": {
      return await updateTable(deps, params);
    }
    case "update_field": {
      return await updateFields(deps, params);
    }
    case "sync_schema": {
      return await syncSchema(deps, params);
    }
    case "rescan_values": {
      const databaseId = requireDatabaseId(params);
      await deps.client.requestParsed(
        DatabaseTaskAck,
        `/api/database/${String(databaseId)}/rescan_values`,
        { method: "POST" },
      );
      return jsonResult(
        `queued a field-values rescan for database ${String(databaseId)} — filter dropdowns refresh as it finishes`,
        { database_id: databaseId, queued: true },
      );
    }
  }
}

async function updateTable(
  deps: MetabaseToolDeps,
  params: MetadataWriteParams,
): Promise<TextToolResult> {
  const tableId = params.table_id;
  if (tableId === undefined) {
    throw new TeachingError("`update_table` needs `table_id` — the table you want to edit.");
  }
  if (params.table === undefined) {
    throw new TeachingError(
      '`update_table` needs `table` — the object holding the edits, e.g. `{display_name: "Orders", description: "One row per order"}`.',
    );
  }
  const updated = await deps.client.requestParsed(Table, `/api/table/${String(tableId)}`, {
    method: "PUT",
    body: TableUpdateInput.parse(params.table),
  });
  return jsonResult(`updated table ${String(updated.id)}`, TableCompact.parse(updated));
}

async function updateFields(
  deps: MetabaseToolDeps,
  params: MetadataWriteParams,
): Promise<TextToolResult> {
  const edits = params.fields;
  if (edits === undefined || edits.length === 0) {
    throw new TeachingError(
      '`update_field` needs `fields` — one entry per column, e.g. `[{field_id: 88, semantic_type: "type/Email"}]`.',
    );
  }

  const updated: unknown[] = [];
  const failures: string[] = [];
  for (const edit of edits) {
    const { field_id: fieldId, ...rest } = edit;
    try {
      const field = await deps.client.requestParsed(Field, `/api/field/${String(fieldId)}`, {
        method: "PUT",
        body: FieldUpdateInput.parse(rest),
      });
      updated.push(FieldCompact.parse(field));
    } catch (error) {
      failures.push(`field ${String(fieldId)}: ${errorMessageOf(error)}`);
    }
  }

  const sections: PayloadSection[] = [{ title: "updated fields", items: updated }];
  return sectionsResult("fields", sections, failures);
}

async function syncSchema(
  deps: MetabaseToolDeps,
  params: MetadataWriteParams,
): Promise<TextToolResult> {
  const databaseId = requireDatabaseId(params);
  await deps.client.requestParsed(
    DatabaseTaskAck,
    `/api/database/${String(databaseId)}/sync_schema`,
    { method: "POST" },
  );

  if (!resolveWait(params.wait)) {
    return jsonResult(
      `queued a schema sync for database ${String(databaseId)} — new tables are not visible until it finishes`,
      { database_id: databaseId, queued: true },
    );
  }

  const database = await pollUntil(
    async () => deps.client.requestParsed(Database, `/api/database/${String(databaseId)}`),
    (value) => value.initial_sync_status === SYNC_COMPLETE,
    {
      timeoutMs: resolveTimeoutMs(params.timeout_ms),
      subject: `The schema sync of database ${String(databaseId)}`,
      recheck: `browse_data {action: "list_tables", database_id: ${String(databaseId)}}`,
    },
  );
  return jsonResult(
    `schema sync of database ${String(databaseId)} complete — \`browse_data\` now sees its current tables`,
    { database_id: databaseId, initial_sync_status: database.initial_sync_status ?? null },
  );
}

function requireDatabaseId(params: MetadataWriteParams): number {
  if (params.database_id === undefined) {
    throw new TeachingError(`\`${params.action}\` needs \`database_id\`.`);
  }
  return params.database_id;
}

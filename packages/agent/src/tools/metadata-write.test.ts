import { FieldSemanticType } from "@metabase/cli/domain";
import { expect, test } from "vitest";
import { type Responder, toolDeps } from "./fake-client";
import { runMetadataWriteTool } from "./metadata-write";
import { TeachingError } from "./teaching-error";

// The closed enum is the teaching: a wrong tag comes back naming every legal one, so the expected
// message is built from the same schema the tool validates against.
const LEGAL_SEMANTIC_TYPES = FieldSemanticType.options
  .map((option) => JSON.stringify(option))
  .join("|");
const FIELD_88_REJECTION = `field 88: semantic_type: Invalid option: expected one of ${LEGAL_SEMANTIC_TYPES}`;

interface FieldOverrides {
  id: number;
  semantic_type: string | null;
  fk_target_field_id?: number | null;
}

function fieldRecord({ id, semantic_type, fk_target_field_id = null }: FieldOverrides): unknown {
  return {
    id,
    table_id: 9,
    name: `column_${String(id)}`,
    display_name: `Column ${String(id)}`,
    description: null,
    base_type: "type/Text",
    semantic_type,
    fk_target_field_id,
  };
}

const TABLE = {
  id: 9,
  name: "orders",
  display_name: "Orders",
  description: "One row per order",
  db_id: 1,
  schema: "public",
  entity_type: "entity/TransactionTable",
};

test("update_table sends only the fields the caller edited", async () => {
  const { deps, requests } = toolDeps(() => TABLE);

  const result = await runMetadataWriteTool(deps, {
    action: "update_table",
    table_id: 9,
    table: { display_name: "Orders", description: "One row per order" },
  });

  expect(requests).toEqual([
    {
      path: "/api/table/9",
      method: "PUT",
      options: {
        method: "PUT",
        body: { display_name: "Orders", description: "One row per order" },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "updated table 9",
    value: {
      id: 9,
      name: "orders",
      display_name: "Orders",
      description: "One row per order",
      db_id: 1,
      schema: "public",
      entity_type: "entity/TransactionTable",
    },
  });
});

test("a batch of field edits is one call, and one bad field does not sink the others", async () => {
  const responder: Responder = (path) => {
    if (path === "/api/field/404") {
      throw new Error("Field 404 does not exist.");
    }
    if (path === "/api/field/88") {
      return fieldRecord({ id: 88, semantic_type: "type/Email" });
    }
    return fieldRecord({ id: 91, semantic_type: "type/FK", fk_target_field_id: 12 });
  };
  const { deps, requests } = toolDeps(responder);

  const result = await runMetadataWriteTool(deps, {
    action: "update_field",
    fields: [
      { field_id: 88, semantic_type: "type/Email" },
      { field_id: 404, semantic_type: "type/Email" },
      { field_id: 91, semantic_type: "type/FK", fk_target_field_id: 12 },
    ],
  });

  expect(requests).toEqual([
    {
      path: "/api/field/88",
      method: "PUT",
      options: { method: "PUT", body: { semantic_type: "type/Email" } },
    },
    {
      path: "/api/field/404",
      method: "PUT",
      options: { method: "PUT", body: { semantic_type: "type/Email" } },
    },
    {
      path: "/api/field/91",
      method: "PUT",
      options: {
        method: "PUT",
        body: { semantic_type: "type/FK", fk_target_field_id: 12 },
      },
    },
  ]);
  expect(result.details).toEqual({
    kind: "sections",
    noun: "fields",
    sections: [
      {
        title: "updated fields",
        items: [
          {
            id: 88,
            name: "column_88",
            display_name: "Column 88",
            description: null,
            table_id: 9,
            base_type: "type/Text",
            semantic_type: "type/Email",
            fk_target_field_id: null,
          },
          {
            id: 91,
            name: "column_91",
            display_name: "Column 91",
            description: null,
            table_id: 9,
            base_type: "type/Text",
            semantic_type: "type/FK",
            fk_target_field_id: 12,
          },
        ],
      },
    ],
    notices: ["field 404: Field 404 does not exist."],
  });
});

test("an unknown semantic type never reaches the server; it comes back as a notice", async () => {
  const { deps, requests } = toolDeps(() => fieldRecord({ id: 88, semantic_type: null }));

  const result = await runMetadataWriteTool(deps, {
    action: "update_field",
    fields: [{ field_id: 88, semantic_type: "type/EmailAddress" }],
  });

  expect(requests).toEqual([]);
  expect(result.details).toEqual({
    kind: "sections",
    noun: "fields",
    sections: [{ title: "updated fields", items: [] }],
    notices: [FIELD_88_REJECTION],
  });
});

const SYNCED_DATABASE: Responder = (_path, options) => {
  if (options?.method === "POST") {
    return { status: "ok" };
  }
  return { id: 1, name: "Warehouse", engine: "postgres", initial_sync_status: "complete" };
};

test("sync_schema waits until the database reports a complete sync", async () => {
  const { deps, requests } = toolDeps(SYNCED_DATABASE);

  const result = await runMetadataWriteTool(deps, { action: "sync_schema", database_id: 1 });

  expect(requests.map((request) => request.path)).toEqual([
    "/api/database/1/sync_schema",
    "/api/database/1",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "schema sync of database 1 complete — `browse_data` now sees its current tables",
    value: { database_id: 1, initial_sync_status: "complete" },
  });
});

test("sync_schema with wait: false returns the ticket and says the tables are not visible yet", async () => {
  const { deps, requests } = toolDeps(() => ({ status: "ok" }));

  const result = await runMetadataWriteTool(deps, {
    action: "sync_schema",
    database_id: 1,
    wait: false,
  });

  expect(requests.map((request) => request.path)).toEqual(["/api/database/1/sync_schema"]);
  expect(result.details).toEqual({
    kind: "json",
    label: "queued a schema sync for database 1 — new tables are not visible until it finishes",
    value: { database_id: 1, queued: true },
  });
});

test("an action that needs a database id says so", async () => {
  const { deps } = toolDeps(() => ({ status: "ok" }));

  await expect(runMetadataWriteTool(deps, { action: "rescan_values" })).rejects.toThrow(
    new TeachingError("`rescan_values` needs `database_id`."),
  );
});

import { expect, test } from "vitest";
import { runBrowseDataTool } from "./browse-data";
import { type Responder, toolDeps } from "./fake-client";
import { TeachingError } from "./teaching-error";

function table(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    display_name: name,
    description: null,
    db_id: 1,
    schema: "public",
    entity_type: "entity/GenericTable",
  };
}

function tableWithFields(id: number, name: string): Record<string, unknown> {
  return {
    ...table(id, name),
    fields: [
      {
        id: id * 10,
        table_id: id,
        name: "total",
        display_name: "Total",
        description: null,
        base_type: "type/Float",
        semantic_type: null,
        fk_target_field_id: null,
      },
    ],
  };
}

test("requires database_id for list_schemas", async () => {
  const { deps } = toolDeps(() => {
    throw new Error("client should not be called");
  });
  await expect(runBrowseDataTool(deps, { action: "list_schemas" })).rejects.toBeInstanceOf(
    TeachingError,
  );
  await expect(runBrowseDataTool(deps, { action: "list_schemas" })).rejects.toThrow(
    "`database_id` is required for action `list_schemas`.",
  );
});

test("projects tables in a schema to the concise envelope", async () => {
  const handler: Responder = (path) => {
    expect(path).toBe("/api/database/1/schema/public");
    return [table(9, "ORDERS")];
  };
  const { deps } = toolDeps(handler);
  const result = await runBrowseDataTool(deps, {
    action: "list_tables",
    database_id: 1,
    schema: "public",
  });
  expect(result.details).toEqual({
    kind: "list",
    noun: "tables",
    envelope: {
      data: [
        {
          id: 9,
          name: "ORDERS",
          display_name: "ORDERS",
          description: null,
          db_id: 1,
          schema: "public",
          entity_type: "entity/GenericTable",
        },
      ],
      returned: 1,
      total: 1,
    },
  });
});

test("isolates a per-table fault in get_fields", async () => {
  const handler: Responder = (path) => {
    if (path === "/api/table/9/query_metadata") {
      return tableWithFields(9, "ORDERS");
    }
    throw new Error("Not found.");
  };
  const { deps } = toolDeps(handler);
  const result = await runBrowseDataTool(deps, { action: "get_fields", table_ids: [9, 99] });
  expect(result.details).toEqual({
    kind: "sections",
    noun: "fields",
    sections: [
      {
        title: "ORDERS (table 9, database 1, schema public)",
        items: [
          {
            id: 90,
            table_id: 9,
            name: "total",
            display_name: "Total",
            description: null,
            base_type: "type/Float",
            semantic_type: null,
            fk_target_field_id: null,
          },
        ],
      },
    ],
    notices: ["table 99: Not found."],
  });
});

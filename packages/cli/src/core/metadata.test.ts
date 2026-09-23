import { describe, expect, it } from "vitest";

import { Database } from "@metabase/client/domain/database";
import { ConfigError } from "@metabase/client/errors";

import { hasDropdownValues, metadataFields, metadataTables, rawValues } from "./metadata";

function field(id: number, tableId: number, name: string, extra: object = {}) {
  return {
    id,
    table_id: tableId,
    name,
    display_name: name,
    description: null,
    base_type: "type/Integer",
    semantic_type: null,
    fk_target_field_id: null,
    ...extra,
  };
}

function table(id: number, schema: string | null, name: string, fields: object[]) {
  return {
    id,
    name,
    display_name: name,
    description: null,
    db_id: 1,
    schema,
    entity_type: null,
    fields,
  };
}

const database = Database.parse({
  id: 1,
  name: "Sample Database",
  tables: [
    table(10, "PUBLIC", "ORDERS", [
      field(100, 10, "ID", { semantic_type: "type/PK" }),
      field(101, 10, "PRODUCT_ID", { semantic_type: "type/FK", fk_target_field_id: 200 }),
      field(102, 10, "STATUS", { base_type: "type/Text", has_field_values: "list" }),
    ]),
    table(20, "PUBLIC", "PRODUCTS", [field(200, 20, "ID", { semantic_type: "type/PK" })]),
  ],
});

describe("metadataTables", () => {
  it("carries the natural-key table ref", () => {
    expect(metadataTables(database).map((row) => row.ref)).toEqual([
      ["Sample Database", "PUBLIC", "ORDERS"],
      ["Sample Database", "PUBLIC", "PRODUCTS"],
    ]);
  });
});

describe("metadataFields", () => {
  const fields = metadataFields(database, 10);

  it("carries the natural-key field ref", () => {
    expect(fields[0]?.ref).toEqual(["Sample Database", "PUBLIC", "ORDERS", "ID"]);
  });

  it("resolves an FK target in another table to its ref", () => {
    expect(fields[1]?.fk_target).toEqual(["Sample Database", "PUBLIC", "PRODUCTS", "ID"]);
    expect(fields[0]?.fk_target).toBeNull();
  });

  it("marks only list fields as dropdowns", () => {
    expect(fields.filter(hasDropdownValues).map((row) => row.name)).toEqual(["STATUS"]);
  });

  it("refuses a table outside the database", () => {
    expect(() => metadataFields(database, 99)).toThrow(ConfigError);
  });
});

describe("rawValues", () => {
  it("keeps the raw value and drops a remapped label", () => {
    expect(rawValues([["shipped"], [1, "One"]])).toEqual(["shipped", 1]);
  });
});

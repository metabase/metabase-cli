import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { planBulkEdit } from "./bulk-edit";

const NO_SELECTOR = new ConfigError(
  "select at least one table: database_ids, schema_ids, table_ids",
);
const NO_EDIT = new ConfigError(
  "set at least one field: data_authority, data_source, data_layer, entity_type, owner_email, owner_user_id",
);

describe("planBulkEdit", () => {
  it("names the selectors that pick tables and the fields the body sets, in schema order", () => {
    expect(
      planBulkEdit({
        table_ids: [3],
        database_ids: [],
        schema_ids: ["1:public"],
        owner_email: null,
        data_layer: "final",
      }),
    ).toEqual({ selectors: ["schema_ids", "table_ids"], edits: ["data_layer", "owner_email"] });
  });

  it("refuses a body with no selector", () => {
    expect(() => planBulkEdit({ owner_email: "dba@example.com" })).toThrow(NO_SELECTOR);
  });

  it("refuses a body whose selectors are all empty", () => {
    expect(() => planBulkEdit({ table_ids: [], owner_email: "dba@example.com" })).toThrow(
      NO_SELECTOR,
    );
  });

  it("refuses a body that selects tables but sets nothing", () => {
    expect(() => planBulkEdit({ table_ids: [3] })).toThrow(NO_EDIT);
  });
});

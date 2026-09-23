import { beforeAll, describe, expect, it } from "vitest";

import { Table, TableCompact } from "@metabase/client/domain/table";
import { parseJson } from "@metabase/client/json";

import { FieldListEnvelope } from "../../packages/cli/src/commands/table/fields";
import { tableFieldsOversizeHint } from "../../packages/cli/src/commands/table/hints";
import { TableListEnvelope } from "../../packages/cli/src/commands/table/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";

const CUSTOMERS_COMPACT = {
  id: SEEDED.tables.customers,
  name: "customers",
  display_name: "Customers",
  description: "Customer dimension; mixed types for sync coverage.",
  db_id: SEEDED.warehouseDbId,
  schema: "public",
  entity_type: "entity/GenericTable",
  is_published: false,
};

const REVIEWS_COMPACT = {
  id: SEEDED.tables.reviews,
  name: "reviews",
  display_name: "Reviews",
  description: null,
  db_id: SEEDED.warehouseDbId,
  schema: "public",
  entity_type: "entity/GenericTable",
  is_published: false,
};

const SEEDED_WAREHOUSE_TABLES = [
  CUSTOMERS_COMPACT,
  {
    id: SEEDED.tables.dailySales,
    name: "daily_sales",
    display_name: "Daily Sales",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "analytics",
    entity_type: "entity/TransactionTable",
    is_published: false,
  },
  {
    id: SEEDED.tables.orderItems,
    name: "order_items",
    display_name: "Order Items",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/TransactionTable",
    is_published: false,
  },
  {
    id: SEEDED.tables.orderSummary,
    name: "order_summary",
    display_name: "Order Summary",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/TransactionTable",
    is_published: false,
  },
  {
    id: SEEDED.tables.orders,
    name: "orders",
    display_name: "Orders",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/TransactionTable",
    is_published: false,
  },
  {
    id: SEEDED.tables.products,
    name: "products",
    display_name: "Products",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/ProductTable",
    is_published: false,
  },
  REVIEWS_COMPACT,
];

const CUSTOMERS_FIELD_NAMES = [
  "attributes",
  "attributes → churned",
  "attributes → company",
  "attributes → newsletter",
  "attributes → plan",
  "avatar",
  "email",
  "external_uuid",
  "full_name",
  "id",
  "is_active",
  "last_ip",
  "lifetime_value_cents",
  "signup_at",
  "signup_date",
  "tags",
];

describe("table e2e", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list filtered by --db-id returns the seeded warehouse tables", async () => {
    const result = await runCli({
      args: ["table", "list", "--db-id", String(SEEDED.warehouseDbId), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual({
      data: SEEDED_WAREHOUSE_TABLES,
      returned: SEEDED_WAREHOUSE_TABLES.length,
      offset: 0,
      total: SEEDED_WAREHOUSE_TABLES.length,
      has_more: false,
      next_offset: null,
    });
  });

  it("list --limit with --offset returns the matching slice and points at the rest", async () => {
    const result = await runCli({
      args: [
        "table",
        "list",
        "--db-id",
        String(SEEDED.warehouseDbId),
        "--json",
        "--limit",
        "2",
        "--offset",
        "2",
      ],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual({
      data: SEEDED_WAREHOUSE_TABLES.slice(2, 4),
      returned: 2,
      offset: 2,
      limit: 2,
      total: SEEDED_WAREHOUSE_TABLES.length,
      has_more: true,
      next_offset: 4,
    });
  });

  it("list --offset onto the last page reports no further items", async () => {
    const offset = SEEDED_WAREHOUSE_TABLES.length - 2;
    const result = await runCli({
      args: [
        "table",
        "list",
        "--db-id",
        String(SEEDED.warehouseDbId),
        "--json",
        "--offset",
        String(offset),
      ],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual({
      data: SEEDED_WAREHOUSE_TABLES.slice(offset),
      returned: 2,
      offset,
      total: SEEDED_WAREHOUSE_TABLES.length,
      has_more: false,
      next_offset: null,
    });
  });

  it("get returns the basic table without hydrating fields", async () => {
    const result = await runCli({
      args: ["table", "get", String(SEEDED.tables.customers), "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, Table);
    expect(parsed.fields).toBeUndefined();
    expect(TableCompact.parse(parsed)).toEqual(CUSTOMERS_COMPACT);
  });

  it("get --include fields hydrates and projects them in compact form", async () => {
    const result = await runCli({
      args: [
        "table",
        "get",
        String(SEEDED.tables.customers),
        "--include",
        "fields",
        "--json",
        "--max-bytes",
        "0",
      ],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, TableCompact);
    const { fields, ...tableBody } = parsed;
    const fieldNames = (fields ?? []).map((field) => field.name).toSorted();
    const allFieldsBelongToCustomersTable = (fields ?? []).every(
      (field) => field.table_id === SEEDED.tables.customers,
    );
    expect({ tableBody, fieldNames, allFieldsBelongToCustomersTable }).toEqual({
      tableBody: CUSTOMERS_COMPACT,
      fieldNames: CUSTOMERS_FIELD_NAMES,
      allFieldsBelongToCustomersTable: true,
    });
  });

  it("get --include fields over a tiny cap exits 2 and points at table fields", async () => {
    const tinyCap = 256;
    const result = await runCli({
      args: [
        "table",
        "get",
        String(SEEDED.tables.customers),
        "--include",
        "fields",
        "--json",
        "--max-bytes",
        String(tinyCap),
      ],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      `over the ${tinyCap}-byte --max-bytes cap; ${tableFieldsOversizeHint(SEEDED.tables.customers)}`,
    );
  });

  it("get rejects an unknown --include value with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "get", String(SEEDED.tables.customers), "--include", "everything", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --include value: "everything" (expected one of: fields)',
    );
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "get", "not-a-number", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid id: "not-a-number" (expected integer)',
    );
    expect(result.stdout).toBe("");
  });

  it("get against a missing table id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["table", "get", "9999999", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/table/9999999.");
  });

  it("fields lists every field on the table in compact form", async () => {
    const result = await runCli({
      args: ["table", "fields", String(SEEDED.tables.customers), "--json", "--max-bytes", "0"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, FieldListEnvelope);
    const fieldNames = envelope.data.map((field) => field.name).toSorted();
    expect({
      returned: envelope.returned,
      offset: envelope.offset,
      total: envelope.total,
      has_more: envelope.has_more,
      next_offset: envelope.next_offset,
      fieldNames,
      everyFieldHasCustomersTableId: envelope.data.every(
        (field) => field.table_id === SEEDED.tables.customers,
      ),
    }).toEqual({
      returned: CUSTOMERS_FIELD_NAMES.length,
      offset: 0,
      total: CUSTOMERS_FIELD_NAMES.length,
      has_more: false,
      next_offset: null,
      fieldNames: CUSTOMERS_FIELD_NAMES,
      everyFieldHasCustomersTableId: true,
    });
  });

  it("fields --values carries each dropdown field's raw values within the window", async () => {
    const result = await runCli({
      args: ["table", "fields", String(SEEDED.tables.orders), "--values", "--limit", "4", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, FieldListEnvelope);
    expect({
      returned: envelope.returned,
      total: envelope.total,
      has_more: envelope.has_more,
      next_offset: envelope.next_offset,
      values: envelope.data.map((field) => ({ name: field.name, values: field.values })),
    }).toEqual({
      returned: 4,
      total: 9,
      has_more: true,
      next_offset: 4,
      values: [
        { name: "id", values: null },
        { name: "customer_id", values: null },
        { name: "status", values: ["delivered", "paid", "pending", "refunded", "shipped"] },
        {
          name: "subtotal_cents",
          values: [199, 499, 599, 699, 799, 1099, 1299, 1599, 1899, 2299, 2599, 4999],
        },
      ],
    });
  });

  it("fields with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "fields", "abc", "--json"],
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });
});

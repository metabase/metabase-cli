import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { FieldListEnvelope } from "../../src/commands/table/fields";
import { TableListEnvelope } from "../../src/commands/table/list";
import { Table, TableCompact } from "../../src/domain/table";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";
import { SEEDED } from "./seed/seeded";
const SEEDED_WAREHOUSE_TABLES = [
  {
    id: SEEDED.tables.customers,
    name: "customers",
    display_name: "Customers",
    description: "Customer dimension; mixed types for sync coverage.",
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/GenericTable",
  },
  {
    id: SEEDED.tables.dailySales,
    name: "daily_sales",
    display_name: "Daily Sales",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "analytics",
    entity_type: "entity/TransactionTable",
  },
  {
    id: SEEDED.tables.orderItems,
    name: "order_items",
    display_name: "Order Items",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/TransactionTable",
  },
  {
    id: SEEDED.tables.orderSummary,
    name: "order_summary",
    display_name: "Order Summary",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/TransactionTable",
  },
  {
    id: SEEDED.tables.orders,
    name: "orders",
    display_name: "Orders",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/TransactionTable",
  },
  {
    id: SEEDED.tables.products,
    name: "products",
    display_name: "Products",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/ProductTable",
  },
  {
    id: SEEDED.tables.reviews,
    name: "reviews",
    display_name: "Reviews",
    description: null,
    db_id: SEEDED.warehouseDbId,
    schema: "public",
    entity_type: "entity/GenericTable",
  },
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
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("list filtered by --db-id returns the seeded warehouse tables", async () => {
    const result = await runCli({
      args: ["table", "list", "--db-id", String(SEEDED.warehouseDbId), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual({
      data: SEEDED_WAREHOUSE_TABLES,
      returned: SEEDED_WAREHOUSE_TABLES.length,
      total: SEEDED_WAREHOUSE_TABLES.length,
    });
  });

  it("get returns the basic table without hydrating fields", async () => {
    const result = await runCli({
      args: ["table", "get", String(SEEDED.tables.customers), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, Table);
    expect(parsed.fields).toBeUndefined();
    expect(TableCompact.parse(parsed)).toEqual({
      id: SEEDED.tables.customers,
      name: "customers",
      display_name: "Customers",
      description: "Customer dimension; mixed types for sync coverage.",
      db_id: SEEDED.warehouseDbId,
      schema: "public",
      entity_type: "entity/GenericTable",
    });
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
      configHome: await makeIsolatedConfigHome(),
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
      tableBody: {
        id: SEEDED.tables.customers,
        name: "customers",
        display_name: "Customers",
        description: "Customer dimension; mixed types for sync coverage.",
        db_id: SEEDED.warehouseDbId,
        schema: "public",
        entity_type: "entity/GenericTable",
      },
      fieldNames: CUSTOMERS_FIELD_NAMES,
      allFieldsBelongToCustomersTable: true,
    });
  });

  it("get rejects an unknown --include value with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "get", String(SEEDED.tables.customers), "--include", "everything", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'invalid --include value: "everything" (expected one of: fields)',
    );
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "get", "not-a-number", "--json"],
      configHome: await makeIsolatedConfigHome(),
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
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/table/9999999.");
  });

  it("metadata returns the table with hydrated fields", async () => {
    const result = await runCli({
      args: [
        "table",
        "metadata",
        String(SEEDED.tables.customers),
        "--json",
        "--full",
        "--max-bytes",
        "0",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, TableCompact);
    const { fields, ...tableBody } = parsed;
    const fieldNames = (fields ?? []).map((field) => field.name).toSorted();

    expect({ tableBody, fieldNames }).toEqual({
      tableBody: {
        id: SEEDED.tables.customers,
        name: "customers",
        display_name: "Customers",
        description: "Customer dimension; mixed types for sync coverage.",
        db_id: SEEDED.warehouseDbId,
        schema: "public",
        entity_type: "entity/GenericTable",
      },
      fieldNames: CUSTOMERS_FIELD_NAMES,
    });
  });

  it("metadata against a missing table id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["table", "metadata", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Not found: GET /api/table/9999999/query_metadata.");
  });

  it("fields lists every field on the table in compact form", async () => {
    const result = await runCli({
      args: ["table", "fields", String(SEEDED.tables.customers), "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, FieldListEnvelope);
    const fieldNames = envelope.data.map((field) => field.name).toSorted();
    expect({
      returned: envelope.returned,
      total: envelope.total,
      fieldNames,
      everyFieldHasCustomersTableId: envelope.data.every(
        (field) => field.table_id === SEEDED.tables.customers,
      ),
    }).toEqual({
      returned: CUSTOMERS_FIELD_NAMES.length,
      total: CUSTOMERS_FIELD_NAMES.length,
      fieldNames: CUSTOMERS_FIELD_NAMES,
      everyFieldHasCustomersTableId: true,
    });
  });

  it("fields with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "fields", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("update edits the table description and returns the updated row", async () => {
    const newDescription = `e2e update marker ${Date.now()}`;
    const update = await runCli({
      args: [
        "table",
        "update",
        String(SEEDED.tables.reviews),
        "--body",
        JSON.stringify({ description: newDescription }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(update.exitCode, update.stderr).toBe(0);
    expect(parseJson(update.stdout, Table).description).toBe(newDescription);

    const restore = await runCli({
      args: [
        "table",
        "update",
        String(SEEDED.tables.reviews),
        "--body",
        JSON.stringify({ description: null }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(restore.exitCode, restore.stderr).toBe(0);
    expect(parseJson(restore.stdout, Table).description).toBeNull();
  });

  it("update rejects multiple body sources", async () => {
    const result = await runCli({
      args: [
        "table",
        "update",
        String(SEEDED.tables.reviews),
        "--body",
        '{"description":"x"}',
        "--file",
        "patch.json",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("multiple body sources given");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "update", "abc", "--body", '{"description":"x"}', "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  it("update enforces the input schema when an unknown enum value is sent", async () => {
    const result = await runCli({
      args: [
        "table",
        "update",
        String(SEEDED.tables.reviews),
        "--body",
        JSON.stringify({ visibility_type: "not-a-real-value" }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("value did not match expected schema");
  });
});

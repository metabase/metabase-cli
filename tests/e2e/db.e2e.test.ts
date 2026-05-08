import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DatabaseListEnvelope } from "../../src/commands/db/list";
import { DatabaseSchemaListEnvelope } from "../../src/commands/db/schemas";
import { DatabaseSchemaTablesEnvelope } from "../../src/commands/db/schema-tables";
import { Database, DatabaseCompact, DatabaseSyncResult } from "../../src/domain/database";
import { TableCompact } from "../../src/domain/table";
import { listEnvelopeSchema } from "../../src/output/types";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES, E2E_TABLES } from "./seed/ids";

const SAVED_QUESTIONS_VIRTUAL_DB_ID = -1337;

const PUBLIC_TABLES_SORTED_BY_DISPLAY_NAME: TableCompact[] = [
  {
    id: E2E_TABLES.CUSTOMERS,
    name: "customers",
    display_name: "Customers",
    description: "Customer dimension; mixed types for sync coverage.",
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    entity_type: "entity/GenericTable",
  },
  {
    id: E2E_TABLES.ORDER_ITEMS,
    name: "order_items",
    display_name: "Order Items",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    entity_type: "entity/TransactionTable",
  },
  {
    id: E2E_TABLES.ORDER_SUMMARY,
    name: "order_summary",
    display_name: "Order Summary",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    entity_type: "entity/TransactionTable",
  },
  {
    id: E2E_TABLES.ORDERS,
    name: "orders",
    display_name: "Orders",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    entity_type: "entity/TransactionTable",
  },
  {
    id: E2E_TABLES.PRODUCTS,
    name: "products",
    display_name: "Products",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    entity_type: "entity/ProductTable",
  },
  {
    id: E2E_TABLES.REVIEWS,
    name: "reviews",
    display_name: "Reviews",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "public",
    entity_type: "entity/GenericTable",
  },
];

const ANALYTICS_TABLES_SORTED_BY_DISPLAY_NAME: TableCompact[] = [
  {
    id: E2E_TABLES.DAILY_SALES,
    name: "daily_sales",
    display_name: "Daily Sales",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "analytics",
    entity_type: "entity/TransactionTable",
  },
];

describe("db e2e", () => {
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

  it("list returns the seeded warehouse database in compact form", async () => {
    const result = await runCli({
      args: ["db", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseListEnvelope)).toEqual({
      data: [{ id: E2E_DATABASES.WAREHOUSE, name: "Warehouse", engine: "postgres" }],
      returned: 1,
      total: 1,
    });
  });

  it("list --include tables hydrates each database with its tables", async () => {
    const result = await runCli({
      args: ["db", "list", "--include", "tables", "--full", "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, listEnvelopeSchema(Database));
    expect(parsed.data.length).toBe(1);
    const warehouse = parsed.data[0];
    expect(warehouse?.id).toBe(E2E_DATABASES.WAREHOUSE);
    const tableIds = (warehouse?.tables ?? []).map((table) => table.id).toSorted();
    const expectedIds = [
      ...PUBLIC_TABLES_SORTED_BY_DISPLAY_NAME,
      ...ANALYTICS_TABLES_SORTED_BY_DISPLAY_NAME,
    ]
      .map((table) => table.id)
      .toSorted();
    expect(tableIds).toEqual(expectedIds);
  });

  it("list --saved includes the Saved Questions virtual database", async () => {
    const result = await runCli({
      args: ["db", "list", "--saved", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseListEnvelope)).toEqual({
      data: [
        { id: E2E_DATABASES.WAREHOUSE, name: "Warehouse", engine: "postgres" },
        {
          id: SAVED_QUESTIONS_VIRTUAL_DB_ID,
          name: "Saved Questions",
          is_saved_questions: true,
        },
      ],
      returned: 2,
      total: 2,
    });
  });

  it("list rejects an unknown --include value with ConfigError", async () => {
    const result = await runCli({
      args: ["db", "list", "--include", "everything", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      'invalid --include value: "everything" (expected one of: tables)',
    );
  });

  it("get returns the warehouse by id", async () => {
    const result = await runCli({
      args: ["db", "get", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseCompact)).toEqual({
      id: E2E_DATABASES.WAREHOUSE,
      name: "Warehouse",
      engine: "postgres",
    });
  });

  it("get --include tables.fields hydrates tables and their fields", async () => {
    const result = await runCli({
      args: [
        "db",
        "get",
        String(E2E_DATABASES.WAREHOUSE),
        "--include",
        "tables.fields",
        "--full",
        "--json",
        "--max-bytes",
        "0",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, Database);
    expect(parsed.id).toBe(E2E_DATABASES.WAREHOUSE);
    const customers = (parsed.tables ?? []).find((table) => table.id === E2E_TABLES.CUSTOMERS);
    expect(customers).toBeDefined();
    expect(Array.isArray(customers?.fields)).toBe(true);
    expect((customers?.fields ?? []).length).toBeGreaterThan(0);
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["db", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("get against a missing database id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["db", "get", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("metadata returns the warehouse with its tables hydrated", async () => {
    const result = await runCli({
      args: [
        "db",
        "metadata",
        String(E2E_DATABASES.WAREHOUSE),
        "--full",
        "--json",
        "--max-bytes",
        "0",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const parsed = parseJson(result.stdout, Database);
    expect(parsed.id).toBe(E2E_DATABASES.WAREHOUSE);
    const tableIds = (parsed.tables ?? []).map((table) => table.id).toSorted();
    const expectedIds = [
      ...PUBLIC_TABLES_SORTED_BY_DISPLAY_NAME,
      ...ANALYTICS_TABLES_SORTED_BY_DISPLAY_NAME,
    ]
      .map((table) => table.id)
      .toSorted();
    expect(tableIds).toEqual(expectedIds);
  });

  it("metadata against a missing database id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["db", "metadata", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("schemas lists the seeded warehouse schemas alphabetically", async () => {
    const result = await runCli({
      args: ["db", "schemas", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseSchemaListEnvelope)).toEqual({
      data: [{ name: "analytics" }, { name: "public" }],
      returned: 2,
      total: 2,
    });
  });

  it("schemas with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["db", "schemas", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
  });

  it("schema-tables lists tables in the public schema sorted by display name", async () => {
    const result = await runCli({
      args: ["db", "schema-tables", String(E2E_DATABASES.WAREHOUSE), "public", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseSchemaTablesEnvelope)).toEqual({
      data: PUBLIC_TABLES_SORTED_BY_DISPLAY_NAME,
      returned: PUBLIC_TABLES_SORTED_BY_DISPLAY_NAME.length,
      total: PUBLIC_TABLES_SORTED_BY_DISPLAY_NAME.length,
    });
  });

  it("schema-tables lists tables in the analytics schema", async () => {
    const result = await runCli({
      args: ["db", "schema-tables", String(E2E_DATABASES.WAREHOUSE), "analytics", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseSchemaTablesEnvelope)).toEqual({
      data: ANALYTICS_TABLES_SORTED_BY_DISPLAY_NAME,
      returned: ANALYTICS_TABLES_SORTED_BY_DISPLAY_NAME.length,
      total: ANALYTICS_TABLES_SORTED_BY_DISPLAY_NAME.length,
    });
  });

  it("schema-tables against an unknown schema surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["db", "schema-tables", String(E2E_DATABASES.WAREHOUSE), "does_not_exist", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("sync-schema triggers a manual schema sync and returns ok", async () => {
    const result = await runCli({
      args: ["db", "sync-schema", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseSyncResult)).toEqual({
      id: E2E_DATABASES.WAREHOUSE,
      status: "ok",
    });
  });

  it("sync-schema against a missing database id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["db", "sync-schema", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Endpoint not found — is this a Metabase instance?");
  });

  it("rescan-values triggers a field-values rescan and returns ok", async () => {
    const result = await runCli({
      args: ["db", "rescan-values", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseSyncResult)).toEqual({
      id: E2E_DATABASES.WAREHOUSE,
      status: "ok",
    });
  });

  it("rescan-values with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["db", "rescan-values", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
  });
});

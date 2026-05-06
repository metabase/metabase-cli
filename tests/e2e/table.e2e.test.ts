import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TableListEnvelope } from "../../src/commands/table/list";
import { Table, TableCompact } from "../../src/domain/table";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_DATABASES, E2E_TABLES } from "./seed/ids";

const SEEDED_WAREHOUSE_TABLES = [
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
    id: E2E_TABLES.DAILY_SALES,
    name: "daily_sales",
    display_name: "Daily Sales",
    description: null,
    db_id: E2E_DATABASES.WAREHOUSE,
    schema: "analytics",
    entity_type: "entity/TransactionTable",
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
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["table", "list", "--db-id", String(E2E_DATABASES.WAREHOUSE), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual({
      data: SEEDED_WAREHOUSE_TABLES,
      returned: SEEDED_WAREHOUSE_TABLES.length,
      total: SEEDED_WAREHOUSE_TABLES.length,
    });
  });

  it("get returns a table with embedded fields when --full", async () => {
    const configHome = await makeIsolatedConfigHome();
    const get = await runCli({
      args: [
        "table",
        "get",
        String(E2E_TABLES.CUSTOMERS),
        "--json",
        "--full",
        "--max-bytes",
        "0",
      ],
      configHome,
      env: authEnv(),
    });

    expect(get.exitCode, get.stderr).toBe(0);
    const parsed = parseJson(get.stdout, Table);
    const fieldNames = (parsed.fields ?? []).map((field) => field.name).toSorted();

    expect({ compact: TableCompact.parse(parsed), fieldNames }).toEqual({
      compact: {
        id: E2E_TABLES.CUSTOMERS,
        name: "customers",
        display_name: "Customers",
        description: "Customer dimension; mixed types for sync coverage.",
        db_id: E2E_DATABASES.WAREHOUSE,
        schema: "public",
        entity_type: "entity/GenericTable",
      },
      fieldNames: CUSTOMERS_FIELD_NAMES,
    });
  });

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["table", "get", "not-a-number", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "not-a-number" (expected integer)');
    expect(result.stdout).toBe("");
  });
});

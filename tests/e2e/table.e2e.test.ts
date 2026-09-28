import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";

import { Table, TableCompact, type TableUpdateInput } from "@metabase/client/domain/table";
import { parseJson } from "@metabase/client/json";

import { FieldListEnvelope } from "../../packages/cli/src/commands/table/fields";
import { TableForeignKeyListEnvelope } from "../../packages/cli/src/commands/table/fks";
import { tableFieldsOversizeHint } from "../../packages/cli/src/commands/table/hints";
import { TableListEnvelope } from "../../packages/cli/src/commands/table/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { seedProbedProfile } from "./seed-profile";
import { SEEDED } from "./seed/seeded";
import { serverHas } from "./server-gate";

const CUSTOMERS_COMPACT = {
  id: SEEDED.tables.customers,
  name: "customers",
  display_name: "Customers",
  description: "Customer dimension; mixed types for sync coverage.",
  db_id: SEEDED.warehouseDbId,
  schema: "public",
  entity_type: "entity/GenericTable",
  active: true,
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
  active: true,
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
    active: true,
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
    active: true,
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
    active: true,
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
    active: true,
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
    active: true,
    is_published: false,
  },
  REVIEWS_COMPACT,
];

const ORDER_TABLES = SEEDED_WAREHOUSE_TABLES.filter((table) => table.name.startsWith("order"));

const ALL_BUT_REVIEWS = SEEDED_WAREHOUSE_TABLES.filter((table) => table.name !== "reviews");

const REVIEWS_OWNER_EMAIL = "dba@example.com";

const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

function warehouseEnvelope(data: typeof SEEDED_WAREHOUSE_TABLES) {
  return {
    data,
    returned: data.length,
    offset: 0,
    total: data.length,
    has_more: false,
    next_offset: null,
  };
}

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
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
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
      configHome: await makeIsolatedConfigHome(),
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
      configHome: await makeIsolatedConfigHome(),
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

  async function listWarehouse(...filters: string[]) {
    return runCli({
      args: ["table", "list", "--db-id", String(SEEDED.warehouseDbId), "--json", ...filters],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
  }

  async function updateReviews(body: TableUpdateInput): Promise<void> {
    const result = await runCli({
      args: ["table", "update", String(SEEDED.tables.reviews), "--body", JSON.stringify(body)],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
  }

  it("list --term keeps the tables whose name starts with it", async () => {
    const result = await listWarehouse("--term", "order");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual(warehouseEnvelope(ORDER_TABLES));
  });

  it("list --visibility-type keeps only the tables marked with it", async () => {
    await updateReviews({ visibility_type: "hidden" });

    const result = await listWarehouse("--visibility-type", "hidden");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual(
      warehouseEnvelope([REVIEWS_COMPACT]),
    );
  });

  it("list --data-layer keeps only the tables placed in it", async () => {
    const layer = serverHas("tableDataLayerTiers") ? "final" : "gold";
    await updateReviews({ data_layer: layer });

    const result = await listWarehouse("--data-layer", layer);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual(
      warehouseEnvelope([REVIEWS_COMPACT]),
    );
  });

  it("list --owner-email keeps only the tables owned by it", async () => {
    await updateReviews({ owner_email: REVIEWS_OWNER_EMAIL });

    const result = await listWarehouse("--owner-email", REVIEWS_OWNER_EMAIL);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual(
      warehouseEnvelope([REVIEWS_COMPACT]),
    );
  });

  it("list --orphan-only drops the tables that have an owner", async () => {
    await updateReviews({ owner_email: REVIEWS_OWNER_EMAIL });

    const result = await listWarehouse("--orphan-only");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableListEnvelope)).toEqual(warehouseEnvelope(ALL_BUT_REVIEWS));
  });

  it("list --can-query --can-write answers every seeded table for the admin, or refuses on a server without the access filters", async () => {
    const result = await listWarehouse("--can-query", "--can-write");

    if (serverHas("tableListAccessFilters")) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TableListEnvelope)).toEqual(
        warehouseEnvelope(SEEDED_WAREHOUSE_TABLES),
      );
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `This operation requires Metabase v59+ (this server is ${bootstrap.server.version?.tag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`,
    );
  });

  it("list --include-transform-targets answers every seeded table when nothing is a transform target, or refuses on a server without the filter", async () => {
    const result = await listWarehouse("--include-transform-targets");

    if (serverHas("tableListTransformTargets")) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TableListEnvelope)).toEqual(
        warehouseEnvelope(SEEDED_WAREHOUSE_TABLES),
      );
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `This operation requires Metabase v60+ (this server is ${bootstrap.server.version?.tag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`,
    );
  });

  it("list --unused-only answers a subset of the seeded tables with the dependencies feature, or refuses without it", async () => {
    const result = await listWarehouse("--unused-only");

    if (serverHas("tableUnusedFilter")) {
      expect(result.exitCode, result.stderr).toBe(0);
      const envelope = parseJson(result.stdout, TableListEnvelope);
      expect(
        envelope.data.every((row) => SEEDED_WAREHOUSE_TABLES.some((t) => t.id === row.id)),
      ).toBe(true);
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "This operation requires the 'dependencies' premium feature (not enabled on this server).",
    );
  });

  it("list --can-query refuses before any request when the cached probe says v58", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["table", "list", "--can-query", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(
      `This operation requires Metabase v59+ (this server is v0.58.0). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`,
    );
    expect(result.stdout).toBe("");
  });

  it("list --unused-only refuses before any request when the cached probe lacks the dependencies feature", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 58);

    const result = await runCli({ args: ["table", "list", "--unused-only", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(
      "This operation requires the 'dependencies' premium feature (not enabled on this server).",
    );
    expect(result.stdout).toBe("");
  });

  it("list rejects an unknown --data-layer value with ConfigError", async () => {
    const result = await listWarehouse("--data-layer", "platinum");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --data-layer value: "platinum" (expected one of: final, internal, hidden, gold, silver, bronze, copper)',
    );
    expect(result.stdout).toBe("");
  });

  it("list refuses a medallion data layer name on a server that speaks tiers, and sends it to one that speaks medallions", async () => {
    const result = await listWarehouse("--data-layer", "gold");

    if (!serverHas("tableDataLayerTiers")) {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TableListEnvelope)).toEqual(warehouseEnvelope([]));
      return;
    }
    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe(
      'data_layer "gold" is a medallion name; this server names a table\'s layer final, internal, hidden',
    );
    expect(result.stdout).toBe("");
  });

  it("list rejects a non-integer --owner-user-id with ConfigError", async () => {
    const result = await listWarehouse("--owner-user-id", "abc");

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --owner-user-id: "abc" (expected integer)',
    );
    expect(result.stdout).toBe("");
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
      configHome: await makeIsolatedConfigHome(),
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
      configHome: await makeIsolatedConfigHome(),
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

  it("fields with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "fields", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
  });

  async function fieldNamed(tableId: number, name: string) {
    const result = await runCli({
      args: ["table", "fields", String(tableId), "--json", "--max-bytes", "0"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const field = parseJson(result.stdout, FieldListEnvelope).data.find((row) => row.name === name);
    assert(field !== undefined, `no field ${name} on table ${tableId}`);
    return field;
  }

  function originTable(tableId: number) {
    const table = SEEDED_WAREHOUSE_TABLES.find((row) => row.id === tableId);
    assert(table !== undefined, `no seeded table ${tableId}`);
    const { id, name, display_name, schema, db_id } = table;
    return { id, name, display_name, schema, db_id };
  }

  it("fks lists the fields in other tables that point at the table", async () => {
    const customersId = await fieldNamed(SEEDED.tables.customers, "id");
    const ordersCustomerId = await fieldNamed(SEEDED.tables.orders, "customer_id");
    const reviewsCustomerId = await fieldNamed(SEEDED.tables.reviews, "customer_id");

    const result = await runCli({
      args: ["table", "fks", String(SEEDED.tables.customers), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const envelope = parseJson(result.stdout, TableForeignKeyListEnvelope);
    const expectedRows = [ordersCustomerId, reviewsCustomerId].map((origin) => ({
      relationship: "Mt1",
      origin_id: origin.id,
      origin: { ...origin, table: originTable(origin.table_id) },
      destination_id: customersId.id,
      destination: customersId,
    }));
    expect({
      ...envelope,
      data: envelope.data.toSorted((a, b) => a.origin_id - b.origin_id),
    }).toEqual({
      data: expectedRows.toSorted((a, b) => a.origin_id - b.origin_id),
      returned: 2,
      offset: 0,
      total: 2,
      has_more: false,
      next_offset: null,
    });
  });

  it("fks answers an empty envelope for a table nothing points at", async () => {
    const result = await runCli({
      args: ["table", "fks", String(SEEDED.tables.reviews), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, TableForeignKeyListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("fks with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["table", "fks", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("fks against a missing table id surfaces a 404 HttpError", async () => {
    const result = await runCli({
      args: ["table", "fks", "9999999", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Not found: GET /api/table/9999999/fks.");
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

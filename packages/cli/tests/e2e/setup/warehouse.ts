import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = resolve(HERE, "..", "docker-compose.yml");

const SEED_TABLES = new Set([
  "public.customers",
  "public.products",
  "public.orders",
  "public.order_items",
  "public.reviews",
  "public.order_summary",
  "analytics.daily_sales",
]);

const SEED_SCHEMAS = new Set([
  "public",
  "analytics",
  "information_schema",
  "pg_catalog",
  "pg_toast",
]);

const LIST_NON_SEED_TABLES_SQL =
  "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('public','analytics');";

const LIST_NON_SEED_SCHEMAS_SQL = "SELECT schema_name FROM information_schema.schemata;";

export async function resetWarehouse(): Promise<void> {
  const [tables, schemas] = await Promise.all([
    runPsqlQuery(LIST_NON_SEED_TABLES_SQL),
    runPsqlQuery(LIST_NON_SEED_SCHEMAS_SQL),
  ]);
  const tableDrops = tables.filter((line) => !SEED_TABLES.has(line));
  const schemaDrops = schemas.filter((line) => !SEED_SCHEMAS.has(line));
  if (tableDrops.length === 0 && schemaDrops.length === 0) {
    return;
  }
  const stmts = [
    ...tableDrops.map((qualified) => `DROP TABLE IF EXISTS ${qualified} CASCADE;`),
    ...schemaDrops.map((schema) => `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`),
  ];
  await runPsql(stmts.join("\n"));
}

async function runPsqlQuery(query: string): Promise<string[]> {
  const result = await runPsql(query);
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runPsql(sql: string): Promise<string> {
  const result = await execa(
    "docker",
    [
      "compose",
      "-f",
      COMPOSE_FILE,
      "exec",
      "-T",
      "data-db",
      "psql",
      "-U",
      "metabase_test",
      "-d",
      "warehouse",
      "-At",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  if (typeof result.stdout !== "string") {
    throw new Error("docker exec psql returned non-string stdout");
  }
  return result.stdout;
}

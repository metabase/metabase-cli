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

const LIST_TABLES_SQL =
  "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('public','analytics');";

export async function dropNonSeedWarehouseTables(): Promise<void> {
  const list = await execa(
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
      LIST_TABLES_SQL,
    ],
    { encoding: "utf8" },
  );
  if (typeof list.stdout !== "string") {
    throw new Error("docker exec psql returned non-string stdout");
  }
  const drops = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !SEED_TABLES.has(line))
    .map((qualified) => `DROP TABLE IF EXISTS ${qualified} CASCADE;`);
  if (drops.length === 0) {
    return;
  }
  await execa(
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
      "-c",
      drops.join("\n"),
    ],
    { encoding: "utf8" },
  );
}

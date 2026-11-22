import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-test",
  description: "Manage transform tests — fixtures and expectations run against temp tables",
  details: [
    "## Only query transforms can be tested",
    "Only query transforms (native SQL or MBQL) can be tested, on Postgres, MySQL, H2, ClickHouse, Redshift or SQL Server. The server refuses any other transform with `transform-test.unsupported-transform`, and any other database with `transform-test.unsupported-driver`.",
    "## Edit a test from its `get --full` output",
    "[`mb transform-test get <id> --full`](#mb-transform-test-get) prints the `inputs` and `expectations` that [`mb transform-test create`](#mb-transform-test-create) and [`mb transform-test update`](#mb-transform-test-update) take. The body is closed at every level, so drop `id`, `entity_id`, `creator_id`, `created_at` and `updated_at` before you send it back.",
    "## Expectation SQL reads only the test's tables",
    "Expectation names must be unique within a test. Expectation SQL may name only the transform's target table and its declared input tables, which the run rewrites to its temp tables. Any other table is refused with `transform-test.unremapped-reference`, and so is a column qualified by a table name instead of an alias (`FROM people p … p.id` passes, `people.id` doesn't), in expectation SQL and the transform's own SQL alike.",
  ].join("\n\n"),
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
  },
});

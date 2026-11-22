import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "db",
  description: "Inspect and sync Metabase databases, and turn their data actions on or off",
  alias: "database",
  details: [
    "## Walk a database from tables to fields",
    "Start with [`mb db get <db-id> --include tables`](#mb-db-get), the compact table map. Pick the relevant tables, then fetch their fields one table at a time with [`mb table fields <table-id>`](table.md#mb-table-fields). When the answer outgrows the `--max-bytes` cap, the error names the next command down the ladder.",
    "On a warehouse with hundreds of tables, traverse by schema ([`mb db schemas <db-id>`](#mb-db-schemas), then [`mb db schema-tables <db-id> <schema>`](#mb-db-schema-tables)), or find tables by name with [`mb search <term> --models table --db-id <db-id>`](search.md).",
  ].join("\n\n"),
  skills: [
    { skill: "core", purpose: "the database traversal ladder and schema sync" },
    { skill: "data-workflow", purpose: "model a raw database into clean tables" },
  ],
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    schemas: () => import("./schemas").then((m) => m.default),
    "schema-tables": () => import("./schema-tables").then((m) => m.default),
    "sync-schema": () => import("./sync-schema").then((m) => m.default),
    "rescan-values": () => import("./rescan-values").then((m) => m.default),
    "set-data-actions": () => import("./set-data-actions").then((m) => m.default),
  },
});

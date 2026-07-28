import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "db",
  description: "Inspect and sync Metabase databases",
  alias: "database",
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
  },
});

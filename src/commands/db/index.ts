import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "db", description: "Inspect and sync Metabase databases", alias: "database" },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    metadata: () => import("./metadata").then((m) => m.default),
    schemas: () => import("./schemas").then((m) => m.default),
    "schema-tables": () => import("./schema-tables").then((m) => m.default),
    "sync-schema": () => import("./sync-schema").then((m) => m.default),
    "rescan-values": () => import("./rescan-values").then((m) => m.default),
  },
});

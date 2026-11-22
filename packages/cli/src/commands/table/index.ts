import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "table",
  description: "Manage Metabase tables",
  skills: [{ skill: "metadata", purpose: "table and column metadata, semantic types, visibility" }],
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    fields: () => import("./fields").then((m) => m.default),
    fks: () => import("./fks").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
    "sync-schema": () => import("./sync-schema").then((m) => m.default),
    "rescan-values": () => import("./rescan-values").then((m) => m.default),
    "discard-values": () => import("./discard-values").then((m) => m.default),
    "bulk-edit": () => import("./bulk-edit").then((m) => m.default),
    "bulk-sync-schema": () => import("./bulk-sync-schema").then((m) => m.default),
    "bulk-rescan-values": () => import("./bulk-rescan-values").then((m) => m.default),
    "bulk-discard-values": () => import("./bulk-discard-values").then((m) => m.default),
  },
});

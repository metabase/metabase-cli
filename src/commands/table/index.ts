import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "table",
  description: "Manage Metabase tables",
  skills: [{ skill: "metadata", purpose: "table and column metadata, semantic types, visibility" }],
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    metadata: () => import("./metadata").then((m) => m.default),
    fields: () => import("./fields").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
  },
});

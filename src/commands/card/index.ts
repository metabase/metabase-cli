import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "card", description: "Manage Metabase cards (questions, models, metrics)" },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    query: () => import("./query").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

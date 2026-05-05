import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "db", description: "Inspect Metabase databases", alias: "database" },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
  },
});

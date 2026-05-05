import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "table", description: "Inspect Metabase tables" },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
  },
});

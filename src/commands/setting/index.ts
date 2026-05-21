import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "setting", description: "Inspect and update Metabase settings" },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
  },
});

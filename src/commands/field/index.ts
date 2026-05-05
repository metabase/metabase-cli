import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "field", description: "Inspect Metabase fields" },
  subCommands: {
    get: () => import("./get").then((m) => m.default),
  },
});

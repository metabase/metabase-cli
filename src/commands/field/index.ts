import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "field", description: "Inspect Metabase fields" },
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    values: () => import("./values").then((m) => m.default),
    summary: () => import("./summary").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
  },
});

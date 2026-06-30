import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "table", description: "Manage Metabase tables" },
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    metadata: () => import("./metadata").then((m) => m.default),
    fields: () => import("./fields").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
    publish: () => import("./publish").then((m) => m.default),
    unpublish: () => import("./unpublish").then((m) => m.default),
  },
});

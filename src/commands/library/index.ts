import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "library",
    description: "Curate the Metabase Library — publish trusted tables to its Data collection",
  },
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    create: () => import("./create").then((m) => m.default),
    publish: () => import("./publish").then((m) => m.default),
    unpublish: () => import("./unpublish").then((m) => m.default),
  },
});

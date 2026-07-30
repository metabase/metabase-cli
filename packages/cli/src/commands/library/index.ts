import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "library",
  description: "Curate the Metabase Library — publish trusted tables to its Data collection",
  skills: [
    { skill: "core", purpose: "publish tables to the Library" },
    { skill: "data-workflow", purpose: "which tables are worth publishing" },
  ],
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    create: () => import("./create").then((m) => m.default),
    publish: () => import("./publish").then((m) => m.default),
    unpublish: () => import("./unpublish").then((m) => m.default),
  },
});

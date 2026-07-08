import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "card",
  description: "Manage Metabase cards (questions, models, metrics)",
  skills: [
    { skill: "mbql", purpose: "author the dataset_query" },
    { skill: "visualization", purpose: "choose display and visualization_settings" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    query: () => import("./query").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

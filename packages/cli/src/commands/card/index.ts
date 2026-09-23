import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "card",
  description: "Inspect and query Metabase cards (questions, models, metrics)",
  skills: [
    { skill: "mbql", purpose: "author the dataset_query" },
    { skill: "visualization", purpose: "choose display and visualization_settings" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    query: () => import("./query").then((mod) => mod.default),
  },
});

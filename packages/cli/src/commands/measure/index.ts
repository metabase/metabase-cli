import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "measure",
  description: "Manage Metabase measures",
  skills: [
    { skill: "mbql", purpose: "the definition aggregation" },
    { skill: "data-workflow", purpose: "define reusable measures" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

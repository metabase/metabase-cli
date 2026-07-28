import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "segment",
  description: "Manage Metabase segments",
  skills: [
    { skill: "mbql", purpose: "the definition filter clause" },
    { skill: "data-workflow", purpose: "define reusable segments" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

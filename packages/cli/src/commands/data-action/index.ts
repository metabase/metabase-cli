import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "data-action",
  description: "Manage Metabase data actions",
  skills: [
    { skill: "data-action", purpose: "author and run data actions" },
    { skill: "native-sql", purpose: "the data action's native query and its template tags" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    execute: () => import("./execute").then((mod) => mod.default),
  },
});

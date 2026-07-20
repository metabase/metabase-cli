import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "snippet",
  description: "Manage Metabase native query snippets",
  skills: [{ skill: "core", purpose: "native-SQL snippets and body input" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

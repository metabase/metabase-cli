import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "collection",
  description: "Manage Metabase collections",
  skills: [{ skill: "core", purpose: "collection ref forms and the transforms namespace" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    items: () => import("./items").then((mod) => mod.default),
    tree: () => import("./tree").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

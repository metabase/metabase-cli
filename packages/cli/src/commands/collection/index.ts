import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "collection",
  description: "Inspect Metabase collections",
  skills: [{ skill: "core", purpose: "collection ref forms and the transforms namespace" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    items: () => import("./items").then((mod) => mod.default),
    tree: () => import("./tree").then((mod) => mod.default),
  },
});

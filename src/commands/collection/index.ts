import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "collection",
    description: "Manage Metabase collections",
  },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    items: () => import("./items").then((mod) => mod.default),
    tree: () => import("./tree").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
  },
});

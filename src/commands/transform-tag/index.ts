import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "transform-tag",
    description: "Manage Metabase transform tags",
  },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

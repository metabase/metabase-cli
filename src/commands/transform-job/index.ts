import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "transform-job",
    description: "Manage Metabase transform jobs",
  },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

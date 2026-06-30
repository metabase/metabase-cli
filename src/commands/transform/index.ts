import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "transform", description: "Manage Metabase transforms" },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    dependencies: () => import("./dependencies").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    "delete-table": () => import("./delete-table").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
    cancel: () => import("./cancel").then((mod) => mod.default),
    "get-run": () => import("./get-run").then((mod) => mod.default),
    runs: () => import("./runs").then((mod) => mod.default),
  },
});

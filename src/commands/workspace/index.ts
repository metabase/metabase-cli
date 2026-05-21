import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "workspace",
    alias: "workspaces",
    description: "Manage Metabase workspaces (workspace-manager)",
  },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    database: () => import("./database").then((mod) => mod.default),
    start: () => import("./start").then((mod) => mod.default),
    stop: () => import("./stop").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    logs: () => import("./logs").then((mod) => mod.default),
    url: () => import("./url").then((mod) => mod.default),
    credentials: () => import("./credentials").then((mod) => mod.default),
    ps: () => import("./ps").then((mod) => mod.default),
    license: () => import("./license").then((mod) => mod.default),
  },
});

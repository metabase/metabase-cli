import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "dashboard",
    description: "Manage Metabase dashboards",
  },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    cards: () => import("./cards").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    "update-dashcard": () => import("./update-dashcard").then((mod) => mod.default),
  },
});

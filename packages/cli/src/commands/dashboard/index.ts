import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "dashboard",
  description: "Manage Metabase dashboards",
  skills: [
    {
      skill: "dashboard",
      purpose: "wiring filters, linked filters, cross-filtering, click behavior, tabs",
    },
    { skill: "visualization", purpose: "dashcard display and visualization_settings" },
    { skill: "core", purpose: "the 24-column dashcard grid layout" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    cards: () => import("./cards").then((mod) => mod.default),
    "parameter-values": () => import("./parameter-values").then((mod) => mod.default),
    subscriptions: () => import("./subscriptions").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    "update-dashcard": () => import("./update-dashcard").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

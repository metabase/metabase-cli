import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "dashboard",
  description: "Inspect Metabase dashboards",
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
  },
});

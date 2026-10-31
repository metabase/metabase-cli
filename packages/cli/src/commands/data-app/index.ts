import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "data-app",
  description: "Manage Metabase data apps",
  skills: [
    { skill: "data-app", purpose: "create, preview, build and publish a data app" },
    { skill: "data-app-ui", purpose: "the app's UI: sandbox, layout, theme, charts, pages" },
    { skill: "data-app-data", purpose: "the questions a data app runs, and its read hooks" },
    { skill: "data-app-filters", purpose: "filter controls and date ranges" },
    { skill: "data-app-actions", purpose: "writes: actions, forms and refresh" },
  ],
  subCommands: {
    scaffold: () => import("./scaffold").then((mod) => mod.default),
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    "generate-schema": () => import("./generate-schema").then((mod) => mod.default),
    "generate-queries": () => import("./generate-queries").then((mod) => mod.default),
    "generate-actions": () => import("./generate-actions").then((mod) => mod.default),
    "set-enabled": () => import("./set-enabled").then((mod) => mod.default),
  },
});

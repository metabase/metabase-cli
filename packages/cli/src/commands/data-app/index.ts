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
    { skill: "data-app-testing", purpose: "unit tests with mocked queries and actions" },
  ],
  subCommands: {
    scaffold: () => import("./scaffold").then((mod) => mod.default),
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    "typed-schema": () => import("./typed-schema").then((mod) => mod.default),
    "set-enabled": () => import("./set-enabled").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

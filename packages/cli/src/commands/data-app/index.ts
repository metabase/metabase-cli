import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "data-app",
  description: "Manage Metabase data apps",
  details: [
    "## A data app lives in the synced repository",
    "A data app is a React app built into one JavaScript bundle, which Metabase serves in a sandbox at `/apps/<slug>`. It lives in the synced git repository under `data_apps/<slug>/`, and its questions and actions live in its collection's files under `collections/data_apps/`. Its content changes in Metabase only through an import of the repository ([mb git-sync import](git-sync.md#mb-git-sync-import)).",
  ].join("\n\n"),
  skills: [
    { skill: "data-app", purpose: "create, preview, build and publish a data app" },
    { skill: "data-app-ui", purpose: "the app's UI: sandbox, layout, theme, charts, pages" },
    { skill: "data-app-data", purpose: "the questions a data app runs, and its read hooks" },
    { skill: "data-app-filters", purpose: "filter controls and date ranges" },
    { skill: "data-app-actions", purpose: "writes: actions, forms and refresh" },
    {
      skill: "data-app-testing",
      purpose: "unit tests with mocked queries and actions, and e2e tests",
    },
  ],
  subCommands: {
    scaffold: () => import("./scaffold").then((mod) => mod.default),
    "sdk-version": () => import("./sdk-version").then((mod) => mod.default),
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    "generate-schema": () => import("./generate-schema").then((mod) => mod.default),
    "generate-queries": () => import("./generate-queries").then((mod) => mod.default),
    "generate-actions": () => import("./generate-actions").then((mod) => mod.default),
    "set-enabled": () => import("./set-enabled").then((mod) => mod.default),
  },
});

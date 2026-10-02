import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "data-app",
  description: "Manage Metabase data apps",
  skills: [
    { skill: "data-app", purpose: "scaffold, build and publish a data app" },
    { skill: "data-app-semantic-layer", purpose: "query Metabase data from a data app" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    push: () => import("./push").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    draft: () => import("./draft").then((mod) => mod.default),
    schema: () => import("./schema").then((mod) => mod.default),
    "repo-status": () => import("./repo-status").then((mod) => mod.default),
    "permission-warnings": () => import("./permission-warnings").then((mod) => mod.default),
  },
});

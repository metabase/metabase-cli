import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "timeline",
  description: "Manage Metabase timelines (event annotations for time-series charts)",
  skills: [
    {
      skill: "core",
      purpose: "collection scoping — events render only on questions in the timeline's collection",
    },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    events: () => import("./events").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

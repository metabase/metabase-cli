import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "timeline-event",
  description: "Manage events on Metabase timelines (list them with `mb timeline events`)",
  skills: [{ skill: "core", purpose: "required event fields and timeline collection scoping" }],
  subCommands: {
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

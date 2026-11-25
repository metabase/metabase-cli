import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "alert",
  description: "Manage Metabase question alerts (scheduled card delivery on a send condition)",
  details: [
    "## The alert commands read card alerts only",
    "Metabase keeps its internal system-event notifications in the same API as question alerts, with ids alongside theirs. So `get`, `update`, `send` and `archive` refuse (exit 2) an id that names anything other than a card alert: sending one would fire an internal Metabase email.",
  ].join("\n\n"),
  skills: [
    {
      skill: "notification",
      purpose: "send conditions, cron schedules, handlers and recipients, testing a send",
    },
    { skill: "core", purpose: "the card an alert watches and how to find its id" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    send: () => import("./send").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

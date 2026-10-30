import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "subscription",
  description: "Manage Metabase dashboard subscriptions (scheduled dashboard delivery)",
  skills: [
    { skill: "dashboard", purpose: "the dashboard and dashcards a subscription delivers" },
    {
      skill: "notification",
      purpose: "channel schedules, recipients, skip_if_empty, per-subscription filter values",
    },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-tag",
  description: "Manage Metabase transform tags",
  skills: [{ skill: "transform", purpose: "tags that drive job schedules" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

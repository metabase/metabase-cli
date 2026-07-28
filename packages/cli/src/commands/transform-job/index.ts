import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-job",
  description: "Manage Metabase transform jobs",
  skills: [{ skill: "transform", purpose: "tag-driven job schedules" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
    transforms: () => import("./transforms").then((mod) => mod.default),
    "set-active": () => import("./set-active").then((mod) => mod.default),
  },
});

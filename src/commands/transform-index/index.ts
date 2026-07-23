import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-index",
  description: "Manage indexes on a transform's target table",
  skills: [{ skill: "transform", purpose: "indexes reapplied on each full transform run" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

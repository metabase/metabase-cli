import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform",
  description: "Inspect and run Metabase transforms",
  skills: [
    { skill: "transform", purpose: "body shape, run-with-wait, iterate" },
    { skill: "mbql", purpose: "MBQL source.query bodies" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    dependencies: () => import("./dependencies").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
    cancel: () => import("./cancel").then((mod) => mod.default),
    "get-run": () => import("./get-run").then((mod) => mod.default),
    runs: () => import("./runs").then((mod) => mod.default),
  },
});

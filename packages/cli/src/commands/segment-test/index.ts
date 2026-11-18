import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "segment-test",
  description: "Manage segment tests — fixtures and expectations run against temp tables",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
    runs: () => import("./runs").then((mod) => mod.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-test",
  description: "Manage transform tests — fixtures and expectations run against temp tables",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
  },
});

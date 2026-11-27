import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "workspace",
  description: "Manage workspaces",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    current: () => import("./current").then((mod) => mod.default),
  },
});

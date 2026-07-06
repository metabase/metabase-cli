import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "workspace", description: "Manage Metabase workspaces", alias: "ws" },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    destroy: () => import("./destroy").then((mod) => mod.default),
  },
});

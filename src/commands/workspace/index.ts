import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "workspace", description: "Manage Metabase workspaces (workspace-manager)" },
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    config: () => import("./config").then((mod) => mod.default),
    "metadata-export": () => import("./metadata-export").then((mod) => mod.default),
    database: () => import("./database").then((mod) => mod.default),
  },
});

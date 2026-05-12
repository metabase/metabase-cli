import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "database",
    description: "Manage databases provisioned to a workspace",
  },
  subCommands: {
    provision: () => import("./provision").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    deprovision: () => import("./deprovision").then((mod) => mod.default),
  },
});

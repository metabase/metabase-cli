import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "license",
    description: "Manage the Metabase Enterprise license token used by workspace start",
  },
  subCommands: {
    set: () => import("./set").then((m) => m.default),
    status: () => import("./status").then((m) => m.default),
    remove: () => import("./remove").then((m) => m.default),
  },
});

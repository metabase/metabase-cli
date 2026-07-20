import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "skills",
    description:
      "Read CLI-bundled skills — always consult the matching skill before acting on a task; they are the source of truth for every workflow.",
  },
  default: "list",
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    path: () => import("./path").then((m) => m.default),
  },
});

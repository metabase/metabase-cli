import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "skills",
    description:
      "Discover and read CLI-bundled skills (SKILL.md files served from the installed version)",
  },
  default: "list",
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    path: () => import("./path").then((m) => m.default),
  },
});

import { defineCommandGroup } from "../../group";

export default defineCommandGroup({
  name: "worktree",
  description: "Manage remote-sync worktrees, one per branch",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    ensure: () => import("./ensure").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

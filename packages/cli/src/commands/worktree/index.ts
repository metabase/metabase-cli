import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "worktree",
  description: "Manage git-sync worktrees: isolated checkouts of a branch's content",
  skills: [{ skill: "git-sync", purpose: "worktree lifecycle and pull/push" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
    pin: () => import("./pin").then((mod) => mod.default),
    unpin: () => import("./unpin").then((mod) => mod.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "git-sync",
  description: "Import a git branch into Metabase and watch the sync",
  skills: [{ skill: "git-sync", purpose: "importing a branch, dirty checks, the branch guard" }],
  subCommands: {
    status: () => import("./status").then((mod) => mod.default),
    tree: () => import("./tree").then((mod) => mod.default),
    "is-dirty": () => import("./is-dirty").then((mod) => mod.default),
    "has-remote-changes": () => import("./has-remote-changes").then((mod) => mod.default),
    dirty: () => import("./dirty").then((mod) => mod.default),
    "current-task": () => import("./current-task").then((mod) => mod.default),
    "cancel-task": () => import("./cancel-task").then((mod) => mod.default),
    wait: () => import("./wait").then((mod) => mod.default),
    import: () => import("./import").then((mod) => mod.default),
    branches: () => import("./branches").then((mod) => mod.default),
    worktree: () => import("./worktree/index").then((mod) => mod.default),
  },
});

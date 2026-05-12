import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "remote-sync", description: "Sync Metabase content with a git remote" },
  subCommands: {
    status: () => import("./status").then((mod) => mod.default),
    "is-dirty": () => import("./is-dirty").then((mod) => mod.default),
    "has-remote-changes": () => import("./has-remote-changes").then((mod) => mod.default),
    dirty: () => import("./dirty").then((mod) => mod.default),
    "current-task": () => import("./current-task").then((mod) => mod.default),
    "cancel-task": () => import("./cancel-task").then((mod) => mod.default),
    wait: () => import("./wait").then((mod) => mod.default),
    import: () => import("./import").then((mod) => mod.default),
    export: () => import("./export").then((mod) => mod.default),
    stash: () => import("./stash").then((mod) => mod.default),
    branches: () => import("./branches").then((mod) => mod.default),
    "create-branch": () => import("./create-branch").then((mod) => mod.default),
    "add-collection": () => import("./add-collection").then((mod) => mod.default),
    "remove-collection": () => import("./remove-collection").then((mod) => mod.default),
  },
});

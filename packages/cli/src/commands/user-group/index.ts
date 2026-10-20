import { defineCommandGroup } from "../group";

// The folder is `user-group` because `commands/group.ts` is the command-group helper.
export default defineCommandGroup({
  name: "group",
  description: "Manage permission groups (user groups)",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

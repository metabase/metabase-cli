import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "glossary",
  description: "Manage the Metabase glossary of business terms",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

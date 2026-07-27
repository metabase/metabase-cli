import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "document",
  description: "Manage Metabase documents",
  skills: [{ skill: "document", purpose: "author the ProseMirror document body" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    update: () => import("./update").then((mod) => mod.default),
    archive: () => import("./archive").then((mod) => mod.default),
  },
});

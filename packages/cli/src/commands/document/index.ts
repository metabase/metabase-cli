import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "document",
  description: "Inspect Metabase documents",
  skills: [{ skill: "document", purpose: "author the ProseMirror document body" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
  },
});

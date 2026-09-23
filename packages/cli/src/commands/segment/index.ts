import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "segment",
  description: "Inspect Metabase segments",
  skills: [
    { skill: "mbql", purpose: "the definition filter clause" },
    { skill: "rde", purpose: "define reusable segments" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
  },
});

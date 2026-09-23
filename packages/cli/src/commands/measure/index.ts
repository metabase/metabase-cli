import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "measure",
  description: "Inspect Metabase measures",
  skills: [
    { skill: "mbql", purpose: "the definition aggregation" },
    { skill: "rde", purpose: "define reusable measures" },
  ],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
  },
});

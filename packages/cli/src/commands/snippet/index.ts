import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "snippet",
  description: "Inspect Metabase native query snippets",
  skills: [{ skill: "core", purpose: "native-SQL snippets and body input" }],
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    get: () => import("./get").then((mod) => mod.default),
  },
});

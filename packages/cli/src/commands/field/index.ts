import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "field",
  description: "Inspect Metabase fields",
  skills: [
    { skill: "metadata", purpose: "semantic types, FK targets, visibility, dropdown behavior" },
  ],
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    values: () => import("./values").then((m) => m.default),
    summary: () => import("./summary").then((m) => m.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "field",
  description: "Manage Metabase fields",
  skills: [
    { skill: "metadata", purpose: "semantic types, FK targets, visibility, dropdown behavior" },
  ],
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    values: () => import("./values").then((m) => m.default),
    summary: () => import("./summary").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
    search: () => import("./search").then((m) => m.default),
    remapping: () => import("./remapping").then((m) => m.default),
    "set-sensitivity": () => import("./set-sensitivity").then((m) => m.default),
  },
});

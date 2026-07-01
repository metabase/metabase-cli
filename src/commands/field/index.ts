import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "field",
  description: "Manage Metabase fields",
  skills: [
    { skill: "core", purpose: "field metadata — semantic types, FK targets, cached values" },
  ],
  subCommands: {
    get: () => import("./get").then((m) => m.default),
    values: () => import("./values").then((m) => m.default),
    summary: () => import("./summary").then((m) => m.default),
    update: () => import("./update").then((m) => m.default),
  },
});

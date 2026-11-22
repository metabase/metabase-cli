import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "api-key",
  description: "Manage Metabase API keys",
  subCommands: {
    list: () => import("./list").then((mod) => mod.default),
    create: () => import("./create").then((mod) => mod.default),
    delete: () => import("./delete").then((mod) => mod.default),
  },
});

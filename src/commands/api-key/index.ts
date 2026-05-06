import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "api-key", description: "Manage Metabase API keys" },
  subCommands: {
    create: () => import("./create").then((mod) => mod.default),
  },
});

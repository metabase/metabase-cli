import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "lineage",
  description: "Inspect dependencies between Metabase and warehouse entities",
  subCommands: {
    dependents: () => import("./dependents").then((mod) => mod.default),
  },
});

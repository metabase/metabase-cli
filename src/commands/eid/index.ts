import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "eid",
    description: "Translate Metabase entity ids (string EIDs) to numeric ids",
  },
  subCommands: {
    translate: () => import("./translate").then((mod) => mod.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "metadata",
  description: "Database metadata on disk",
  skills: [{ skill: "metabase-database-metadata", purpose: "reading the extracted metadata tree" }],
  subCommands: {
    extract: () => import("./extract").then((mod) => mod.default),
  },
});

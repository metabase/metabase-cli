import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "data-sensitivity",
  description: "Propose data sensitivity labels for fields with the LLM (dry run, nothing written)",
  skills: [{ skill: "metadata", purpose: "what a data_sensitivity label is and how to apply one" }],
  subCommands: {
    "scan-db": () => import("./scan-db").then((mod) => mod.default),
    "scan-table": () => import("./scan-table").then((mod) => mod.default),
  },
});

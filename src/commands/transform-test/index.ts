import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "transform-test",
    description:
      "Test transforms or cards (and sub-graphs) against fixture CSVs without touching real tables",
  },
  subCommands: {
    inputs: () => import("./inputs").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "transform-test",
  description:
    "Test transforms or cards (and sub-graphs) against fixture CSVs without touching real tables",
  skills: [
    { skill: "transform-test", purpose: "fixtures, assertions, suites" },
    { skill: "transform-test-plan", purpose: "planning what to test" },
  ],
  subCommands: {
    inputs: () => import("./inputs").then((mod) => mod.default),
    run: () => import("./run").then((mod) => mod.default),
  },
});

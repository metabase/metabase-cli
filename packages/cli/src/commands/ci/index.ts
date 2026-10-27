import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "ci",
  description: "Check a branch's transforms the way CI does",
  skills: [{ skill: "ci", purpose: "running a check, reading its results, fixing what failed" }],
  subCommands: {
    run: () => import("./run").then((mod) => mod.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "ci",
  description: "Check a branch's transforms the way CI does",
  subCommands: {
    run: () => import("./run").then((mod) => mod.default),
  },
});

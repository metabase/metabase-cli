import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "ci",
  description:
    "Check a branch's transforms the way CI does. Experimental: flags, output and exit codes can change in any release",
  subCommands: {
    run: () => import("./run").then((mod) => mod.default),
  },
});

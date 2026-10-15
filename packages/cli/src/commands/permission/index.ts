import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "permission",
  description: "Read and update data permissions",
  subCommands: {
    graph: () => import("./graph").then((mod) => mod.default),
    "update-graph": () => import("./update-graph").then((mod) => mod.default),
  },
});

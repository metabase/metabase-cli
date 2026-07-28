import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "upload",
  description: "Upload CSV files into Metabase",
  subCommands: {
    csv: () => import("./csv").then((m) => m.default),
    append: () => import("./append").then((m) => m.default),
    replace: () => import("./replace").then((m) => m.default),
  },
});

import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "dependency",
  description: "Trace what Metabase content depends on and what depends on it",
  subCommands: {
    graph: () => import("./graph").then((m) => m.default),
    dependents: () => import("./dependents").then((m) => m.default),
    broken: () => import("./broken").then((m) => m.default),
    unreferenced: () => import("./unreferenced").then((m) => m.default),
    breaking: () => import("./breaking").then((m) => m.default),
  },
});

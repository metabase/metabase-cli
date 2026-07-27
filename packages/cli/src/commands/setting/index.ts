import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "setting",
  description: "Inspect and update Metabase settings",
  skills: [{ skill: "core", purpose: "setting get/set JSON value quoting" }],
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
  },
});

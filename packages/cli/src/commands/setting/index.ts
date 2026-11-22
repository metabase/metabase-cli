import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "setting",
  description: "Inspect and update Metabase settings",
  details: [
    "## Each setting has its own access rules",
    "[mb setting get](#mb-setting-get) and [mb setting set](#mb-setting-set) work on one key, and the server judges each call by that setting's own access rules.",
  ].join("\n\n"),
  skills: [{ skill: "core", purpose: "setting get/set JSON value quoting" }],
  subCommands: {
    list: () => import("./list").then((m) => m.default),
    get: () => import("./get").then((m) => m.default),
    set: () => import("./set").then((m) => m.default),
  },
});

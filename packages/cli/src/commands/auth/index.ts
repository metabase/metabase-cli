import { defineCommandGroup } from "../group";

export default defineCommandGroup({
  name: "auth",
  description: "Authenticate against a Metabase instance",
  defaultCommand: "login",
  skills: [{ skill: "core", purpose: "authentication and named profiles" }],
  subCommands: {
    login: () => import("./login").then((m) => m.default),
    status: () => import("./status").then((m) => m.default),
    list: () => import("./list").then((m) => m.default),
    logout: () => import("./logout").then((m) => m.default),
  },
});

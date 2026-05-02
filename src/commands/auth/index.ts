import { defineCommand } from "citty";

export default defineCommand({
  meta: { name: "auth", description: "Authenticate against a Metabase instance" },
  default: "login",
  subCommands: {
    login: () => import("./login").then((m) => m.default),
    status: () => import("./status").then((m) => m.default),
    logout: () => import("./logout").then((m) => m.default),
  },
});

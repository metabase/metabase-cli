import { defineCommand } from "citty";
import type { CommandDef } from "citty";

import packageJson from "../package.json" with { type: "json" };

const main: CommandDef = defineCommand({
  meta: {
    name: "metabase",
    version: packageJson.version,
    description: packageJson.description,
  },
  subCommands: {
    auth: () => import("./commands/auth").then((mod) => mod.default),
    license: () => import("./commands/license").then((mod) => mod.default),
    db: () => import("./commands/db").then((mod) => mod.default),
    table: () => import("./commands/table").then((mod) => mod.default),
    field: () => import("./commands/field").then((mod) => mod.default),
    card: () => import("./commands/card").then((mod) => mod.default),
    transform: () => import("./commands/transform").then((mod) => mod.default),
    "transform-job": () => import("./commands/transform-job").then((mod) => mod.default),
    __manifest: (): Promise<CommandDef> =>
      import("./commands/manifest").then((mod) => mod.createManifestCommand(main)),
  },
});

export default main;

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
    __manifest: (): Promise<CommandDef> =>
      import("./commands/manifest").then((mod) => mod.createManifestCommand(main)),
  },
});

export default main;

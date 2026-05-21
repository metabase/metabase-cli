import { defineCommand } from "citty";
import type { CommandDef } from "citty";

import packageJson from "../package.json" with { type: "json" };

const main: CommandDef = defineCommand({
  meta: {
    name: "mb",
    version: packageJson.version,
    description: packageJson.description,
  },
  subCommands: {
    auth: () => import("./commands/auth").then((mod) => mod.default),
    db: () => import("./commands/db").then((mod) => mod.default),
    table: () => import("./commands/table").then((mod) => mod.default),
    field: () => import("./commands/field").then((mod) => mod.default),
    card: () => import("./commands/card").then((mod) => mod.default),
    dashboard: () => import("./commands/dashboard").then((mod) => mod.default),
    collection: () => import("./commands/collection").then((mod) => mod.default),
    transform: () => import("./commands/transform").then((mod) => mod.default),
    "transform-job": () => import("./commands/transform-job").then((mod) => mod.default),
    setting: () => import("./commands/setting").then((mod) => mod.default),
    search: () => import("./commands/search").then((mod) => mod.default),
    "git-sync": () => import("./commands/git-sync").then((mod) => mod.default),
    workspace: () => import("./commands/workspace").then((mod) => mod.default),
    setup: () => import("./commands/setup").then((mod) => mod.default),
    "api-key": () => import("./commands/api-key").then((mod) => mod.default),
    snippet: () => import("./commands/snippet").then((mod) => mod.default),
    segment: () => import("./commands/segment").then((mod) => mod.default),
    measure: () => import("./commands/measure").then((mod) => mod.default),
    eid: () => import("./commands/eid").then((mod) => mod.default),
    query: () => import("./commands/query").then((mod) => mod.default),
    uuid: () => import("./commands/uuid").then((mod) => mod.default),
    upgrade: () => import("./commands/upgrade").then((mod) => mod.default),
    skills: () => import("./commands/skills").then((mod) => mod.default),
    __manifest: (): Promise<CommandDef> =>
      import("./commands/manifest").then((mod) => mod.createManifestCommand(main)),
  },
});

export default main;

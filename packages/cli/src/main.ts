import { defineCommand } from "citty";
import type { CommandDef } from "citty";

import packageJson from "../package.json" with { type: "json" };

import { setMetabaseAugment } from "./runtime/command-augment";

const main: CommandDef = defineCommand({
  meta: {
    name: "mb",
    version: packageJson.version,
    description: packageJson.description,
  },
  subCommands: {
    auth: () => import("./commands/auth").then((mod) => mod.default),
    metadata: () => import("./commands/metadata").then((mod) => mod.default),
    check: () => import("./commands/check").then((mod) => mod.default),
    save: () => import("./commands/save").then((mod) => mod.default),
    skills: () => import("./commands/skills").then((mod) => mod.default),
  },
});

setMetabaseAugment(main, {
  examples: [],
  details: null,
  skills: [
    { skill: "core", purpose: "the metadata -> edit -> check -> save loop" },
    { skill: "representations", purpose: "the YAML format spec and per-entity schemas" },
  ],
  inputSchema: null,
  outputSchema: null,
  requires: null,
});

export default main;

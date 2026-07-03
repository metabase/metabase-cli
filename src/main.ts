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
    db: () => import("./commands/db").then((mod) => mod.default),
    table: () => import("./commands/table").then((mod) => mod.default),
    field: () => import("./commands/field").then((mod) => mod.default),
    upload: () => import("./commands/upload").then((mod) => mod.default),
    card: () => import("./commands/card").then((mod) => mod.default),
    dashboard: () => import("./commands/dashboard").then((mod) => mod.default),
    collection: () => import("./commands/collection").then((mod) => mod.default),
    library: () => import("./commands/library").then((mod) => mod.default),
    document: () => import("./commands/document").then((mod) => mod.default),
    transform: () => import("./commands/transform").then((mod) => mod.default),
    "transform-job": () => import("./commands/transform-job").then((mod) => mod.default),
    "transform-tag": () => import("./commands/transform-tag").then((mod) => mod.default),
    setting: () => import("./commands/setting").then((mod) => mod.default),
    search: () => import("./commands/search").then((mod) => mod.default),
    "git-sync": () => import("./commands/git-sync").then((mod) => mod.default),
    setup: () => import("./commands/setup").then((mod) => mod.default),
    snippet: () => import("./commands/snippet").then((mod) => mod.default),
    segment: () => import("./commands/segment").then((mod) => mod.default),
    measure: () => import("./commands/measure").then((mod) => mod.default),
    eid: () => import("./commands/eid").then((mod) => mod.default),
    query: () => import("./commands/query").then((mod) => mod.default),
    uuid: () => import("./commands/uuid").then((mod) => mod.default),
    upgrade: () => import("./commands/upgrade").then((mod) => mod.default),
    skills: () => import("./commands/skills").then((mod) => mod.default),
  },
});

setMetabaseAugment(main, {
  examples: [],
  details: null,
  skills: [
    { skill: "core", purpose: "auth, conventions, and per-resource footguns" },
    {
      skill: "data-workflow",
      purpose: "guided end-to-end: raw data → clean tables → metrics → answers → dashboards",
    },
  ],
  inputSchema: null,
  outputSchema: null,
  capabilities: null,
});

export default main;

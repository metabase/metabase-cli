import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { summarizeCapabilities } from "@metabase/client/version/capability-summary";
import { type MethodKey, methodRequirements } from "@metabase/client/version/requirements";

import { defineMetabaseCommand } from "../commands/runtime";
import main from "../main";
import { buildHelpEntry, buildHelpIndex, resolveCommandPath } from "./command-help";
import type { CommandHelpEntry } from "./command-help";

describe("buildHelpIndex", () => {
  it("walks lazy subCommands into full-path index entries", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "leaf", description: "a leaf" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });
    const group = defineCommand({
      meta: { name: "group", description: "a group" },
      subCommands: { leaf: () => Promise.resolve(leaf) },
    });
    const root = defineCommand({
      meta: { name: "root", description: "root" },
      subCommands: { group: () => Promise.resolve(group) },
    });

    const index = await buildHelpIndex(root, []);

    expect(index).toEqual({
      description: "root",
      skills: [],
      commands: [{ command: "group leaf", description: "a leaf" }],
    });
  });

  it("skips commands marked meta.hidden = true (and their subtrees)", async () => {
    const visible = defineMetabaseCommand({
      meta: { name: "visible", description: "visible" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });
    const hidden = defineMetabaseCommand({
      meta: { name: "hidden", description: "hidden", hidden: true },
      requires: [],
      args: {},
      run() {
        return;
      },
    });
    const root = defineCommand({
      meta: { name: "root" },
      subCommands: {
        visible: () => Promise.resolve(visible),
        hidden: () => Promise.resolve(hidden),
      },
    });

    const index = await buildHelpIndex(root, []);

    expect(index).toEqual({
      description: null,
      skills: [],
      commands: [{ command: "visible", description: "visible" }],
    });
  });

  it("lists a leaf that declares no description as null rather than an empty sentence", async () => {
    const leaf = defineCommand({
      meta: { name: "leaf" },
      args: {},
      run() {
        return;
      },
    });
    const root = defineCommand({
      meta: { name: "root", description: "root" },
      subCommands: { leaf: () => Promise.resolve(leaf) },
    });

    const index = await buildHelpIndex(root, []);

    expect(index).toEqual({
      description: "root",
      skills: [],
      commands: [{ command: "leaf", description: null }],
    });
  });
});

describe("buildHelpEntry", () => {
  it("converts citty args to entries with type, required, default, alias, options", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "leaf", description: "leaf" },
      requires: [],
      args: {
        flag: { type: "string", description: "a flag", alias: "f" },
        toggle: { type: "boolean", description: "toggle", default: false },
        token: { type: "positional", description: "tok", required: true },
        mode: { type: "enum", options: ["a", "b"], description: "mode" },
      },
      run() {
        return;
      },
    });

    const entry = await buildHelpEntry(leaf, ["leaf"]);

    expect(entry.args).toEqual([
      {
        name: "flag",
        type: "string",
        required: false,
        description: "a flag",
        alias: ["f"],
      },
      {
        name: "toggle",
        type: "boolean",
        required: false,
        description: "toggle",
        default: false,
      },
      {
        name: "token",
        type: "positional",
        required: true,
        description: "tok",
      },
      {
        name: "mode",
        type: "enum",
        required: false,
        description: "mode",
        options: ["a", "b"],
      },
    ]);
  });

  it("emits the JSON Schema of outputSchema and forwards examples for metabase commands", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "leaf", description: "leaf" },
      requires: [],
      args: {},
      outputSchema: z.object({ ok: z.boolean(), name: z.string() }),
      examples: ["root leaf --json"],
      run() {
        return;
      },
    });

    const entry = await buildHelpEntry(leaf, ["group", "leaf"]);

    expect(entry).toEqual({
      command: "group leaf",
      description: "leaf",
      skills: [],
      examples: ["root leaf --json"],
      args: [],
      inputSchema: null,
      outputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          ok: { type: "boolean" },
          name: { type: "string" },
        },
        required: ["ok", "name"],
        additionalProperties: false,
      },
      requires: { methods: [], features: [] },
      capabilities: summarizeCapabilities([]),
    });
  });

  it("emits the JSON Schema of inputSchema for commands that declare a body contract", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "create", description: "create" },
      requires: [],
      args: {},
      inputSchema: z.object({ name: z.string() }),
      run() {
        return;
      },
    });

    const entry = await buildHelpEntry(leaf, ["create"]);

    expect(entry.inputSchema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("forwards details for metabase commands that declare it and omits the key otherwise", async () => {
    const withDetails = defineMetabaseCommand({
      meta: { name: "with", description: "short" },
      requires: [],
      args: {},
      details: "the long per-command knowledge",
      run() {
        return;
      },
    });
    const without = defineMetabaseCommand({
      meta: { name: "without", description: "short" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });

    const withEntry = await buildHelpEntry(withDetails, ["with"]);
    const withoutEntry = await buildHelpEntry(without, ["without"]);

    expect(withEntry.details).toBe("the long per-command knowledge");
    expect("details" in withoutEntry).toBe(false);
  });

  it("forwards declared skill pointers and defaults to an empty array otherwise", async () => {
    const withSkills = defineMetabaseCommand({
      meta: { name: "with", description: "short" },
      requires: [],
      args: {},
      skills: [{ skill: "mbql", purpose: "author the dataset_query" }],
      run() {
        return;
      },
    });
    const without = defineMetabaseCommand({
      meta: { name: "without", description: "short" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });

    const withEntry = await buildHelpEntry(withSkills, ["with"]);
    const withoutEntry = await buildHelpEntry(without, ["without"]);

    expect(withEntry.skills).toEqual([{ skill: "mbql", purpose: "author the dataset_query" }]);
    expect(withoutEntry.skills).toEqual([]);
  });

  it("builds a minimal entry for a raw defineCommand leaf without an augment", async () => {
    const leaf = defineCommand({
      meta: { name: "leaf", description: "raw" },
      args: {},
      run() {
        return;
      },
    });

    const entry = await buildHelpEntry(leaf, ["leaf"]);

    expect(entry).toEqual({
      command: "leaf",
      description: "raw",
      skills: [],
      examples: [],
      args: [],
      inputSchema: null,
      outputSchema: null,
      requires: null,
      capabilities: null,
    });
  });

  it("reports a leaf that declares no description as null rather than an empty sentence", async () => {
    const leaf = defineCommand({
      meta: { name: "leaf" },
      args: {},
      run() {
        return;
      },
    });

    const entry = await buildHelpEntry(leaf, ["leaf"]);

    expect(entry).toEqual({
      command: "leaf",
      description: null,
      skills: [],
      examples: [],
      args: [],
      inputSchema: null,
      outputSchema: null,
      requires: null,
      capabilities: null,
    });
  });
});

const ALL_COMMANDS = [
  "auth login",
  "auth status",
  "auth list",
  "auth logout",
  "db list",
  "db get",
  "db schemas",
  "db schema-tables",
  "db sync-schema",
  "db rescan-values",
  "table list",
  "table get",
  "table fields",
  "table update",
  "field get",
  "field values",
  "field summary",
  "field update",
  "upload csv",
  "upload append",
  "upload replace",
  "content-translation download",
  "content-translation upload",
  "card list",
  "card get",
  "card query",
  "card alerts",
  "card create",
  "card update",
  "card archive",
  "dashboard list",
  "dashboard get",
  "dashboard cards",
  "dashboard parameter-values",
  "dashboard subscriptions",
  "dashboard create",
  "dashboard update",
  "dashboard update-dashcard",
  "dashboard archive",
  "subscription list",
  "subscription get",
  "subscription create",
  "subscription update",
  "subscription archive",
  "alert list",
  "alert get",
  "alert create",
  "alert update",
  "alert send",
  "alert archive",
  "collection list",
  "collection get",
  "collection items",
  "collection tree",
  "collection create",
  "collection archive",
  "library get",
  "library create",
  "library publish",
  "library unpublish",
  "document list",
  "document get",
  "document create",
  "document update",
  "document archive",
  "transform list",
  "transform get",
  "transform dependencies",
  "transform create",
  "transform update",
  "transform delete",
  "transform delete-table",
  "transform run",
  "transform cancel",
  "transform get-run",
  "transform runs",
  "transform-job list",
  "transform-job get",
  "transform-job create",
  "transform-job update",
  "transform-job delete",
  "transform-job run",
  "transform-job transforms",
  "transform-job set-active",
  "transform-tag list",
  "transform-tag create",
  "transform-tag update",
  "transform-tag delete",
  "setting list",
  "setting get",
  "setting set",
  "search",
  "git-sync status",
  "git-sync is-dirty",
  "git-sync has-remote-changes",
  "git-sync dirty",
  "git-sync current-task",
  "git-sync cancel-task",
  "git-sync wait",
  "git-sync import",
  "git-sync export",
  "git-sync stash",
  "git-sync branches",
  "git-sync create-branch",
  "git-sync add-collection",
  "git-sync remove-collection",
  "setup",
  "snippet list",
  "snippet get",
  "snippet create",
  "snippet update",
  "snippet archive",
  "segment list",
  "segment get",
  "segment create",
  "segment update",
  "segment archive",
  "measure list",
  "measure get",
  "measure create",
  "measure update",
  "measure archive",
  "timeline list",
  "timeline get",
  "timeline events",
  "timeline create",
  "timeline update",
  "timeline archive",
  "timeline delete",
  "timeline-event get",
  "timeline-event create",
  "timeline-event update",
  "timeline-event archive",
  "timeline-event delete",
  "eid",
  "query",
  "uuid",
  "upgrade",
  "skills list",
  "skills get",
  "skills path",
];

function requiresOf(method: MethodKey): CommandHelpEntry["requires"] {
  return { methods: [method], features: Array.from(methodRequirements(method)) };
}

let cachedEntries: Promise<CommandHelpEntry[]> | null = null;

function allEntries(): Promise<CommandHelpEntry[]> {
  cachedEntries ??= Promise.all(
    ALL_COMMANDS.map(async (command) => {
      const segments = command.split(" ");
      return buildHelpEntry(await resolveCommandPath(main, segments), segments);
    }),
  );
  return cachedEntries;
}

describe("command tree contract", () => {
  it("indexes every leaf command", async () => {
    const index = await buildHelpIndex(main, []);
    expect(index.commands.map((entry) => entry.command)).toEqual(ALL_COMMANDS);
  });

  it("every leaf declares a description", async () => {
    for (const entry of await allEntries()) {
      expect(entry.description, `missing description for ${entry.command}`).not.toBeNull();
    }
  });

  it("every leaf declares examples and an output schema", async () => {
    for (const entry of await allEntries()) {
      expect(entry.examples.length, `missing examples for ${entry.command}`).toBeGreaterThan(0);
      expect(entry.outputSchema, `missing outputSchema for ${entry.command}`).not.toBeNull();
    }
  });

  it("declares an input schema on every command that accepts a JSON body", async () => {
    for (const entry of await allEntries()) {
      const acceptsBody = entry.args.some((arg) => arg.name === "body");
      if (acceptsBody) {
        expect(entry.inputSchema, `missing inputSchema for ${entry.command}`).not.toBeNull();
      }
    }
  });

  it("reports the measure methods and the feature they need, and card list as baseline", async () => {
    const entries = await allEntries();
    const measureRequires = Object.fromEntries(
      entries
        .filter((entry) => entry.command.startsWith("measure "))
        .map((entry) => [entry.command, entry.requires]),
    );
    expect(measureRequires).toEqual({
      "measure list": { methods: ["measure.list"], features: ["measures"] },
      "measure get": { methods: ["measure.get"], features: ["measures"] },
      "measure create": { methods: ["measure.create"], features: ["measures"] },
      "measure update": { methods: ["measure.update"], features: ["measures"] },
      "measure archive": { methods: ["measure.archive"], features: ["measures"] },
    });

    const cardList = entries.find((entry) => entry.command === "card list");
    expect(cardList?.requires).toEqual({ methods: ["card.list"], features: [] });
  });

  it("reports the premium feature behind every content translation command", async () => {
    const entries = await allEntries();
    const requires = Object.fromEntries(
      entries
        .filter((entry) => entry.command.startsWith("content-translation "))
        .map((entry) => [entry.command, entry.requires]),
    );
    expect(requires).toEqual({
      "content-translation download": {
        methods: ["contentTranslation.download"],
        features: ["contentTranslation"],
      },
      "content-translation upload": {
        methods: ["contentTranslation.upload"],
        features: ["contentTranslation"],
      },
    });
  });

  it("carries each transform method's requirements through to its command", async () => {
    const entries = await allEntries();
    const transformRequires = Object.fromEntries(
      entries
        .filter(
          (entry) =>
            entry.command.startsWith("transform ") || entry.command.startsWith("transform-job "),
        )
        .map((entry) => [entry.command, entry.requires]),
    );
    expect(transformRequires).toEqual({
      "transform list": requiresOf("transform.list"),
      "transform get": requiresOf("transform.get"),
      "transform dependencies": requiresOf("transform.dependencies"),
      "transform create": requiresOf("transform.create"),
      "transform update": requiresOf("transform.update"),
      "transform delete": requiresOf("transform.delete"),
      "transform run": requiresOf("transform.run"),
      "transform runs": requiresOf("transform.runPages"),
      "transform get-run": requiresOf("transform.getRun"),
      "transform cancel": requiresOf("transform.cancel"),
      "transform delete-table": requiresOf("transform.deleteTable"),
      "transform-job list": requiresOf("transformJob.list"),
      "transform-job get": requiresOf("transformJob.get"),
      "transform-job create": requiresOf("transformJob.create"),
      "transform-job update": requiresOf("transformJob.update"),
      "transform-job delete": requiresOf("transformJob.delete"),
      "transform-job run": requiresOf("transformJob.run"),
      "transform-job transforms": requiresOf("transformJob.transforms"),
      "transform-job set-active": requiresOf("transformJob.setActive"),
    });
  });

  it("summarizes a command's features as the single floor and token its capabilities carry", async () => {
    const entries = await allEntries();
    const summaries = Object.fromEntries(
      entries
        .filter((entry) =>
          ["card list", "measure list", "transform-job set-active", "library get"].includes(
            entry.command,
          ),
        )
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(summaries).toEqual({
      "card list": summarizeCapabilities([]),
      "measure list": summarizeCapabilities(["measures"]),
      "transform-job set-active": summarizeCapabilities(["transformJobActivation", "transforms"]),
      "library get": summarizeCapabilities(["library"]),
    });
  });

  it("advertises a --limit default on search alone, so the shared flag description stays true", async () => {
    const entries = await allEntries();
    const withDefault = Object.fromEntries(
      entries
        .map((entry) => [entry.command, entry.args.find((arg) => arg.name === "limit")] as const)
        .filter(([, limit]) => limit?.default !== undefined),
    );
    expect(withDefault).toEqual({
      search: {
        name: "limit",
        type: "string",
        required: false,
        description: "Max items to return",
        default: "20",
      },
    });
  });

  it("reports null requires and capabilities for exactly the commands that never touch a Metabase server", async () => {
    const entries = await allEntries();
    const local = entries.filter((entry) => entry.requires === null).map((entry) => entry.command);
    expect(
      entries.filter((entry) => entry.capabilities === null).map((entry) => entry.command),
    ).toEqual(local);
    expect(local.toSorted()).toEqual([
      "auth status",
      "skills get",
      "skills list",
      "skills path",
      "upgrade",
      "uuid",
    ]);
  });
});

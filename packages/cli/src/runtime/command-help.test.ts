import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";
import { z } from "zod";

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
    });
  });
});

const ALL_COMMANDS = [
  "auth login",
  "auth status",
  "auth list",
  "auth logout",
  "metadata",
  "check",
  "save",
  "skills list",
  "skills get",
  "skills path",
];

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
    const entries = await allEntries();
    const undescribed = entries
      .filter((entry) => entry.description === null)
      .map((entry) => entry.command);
    expect(entries.length).toBe(ALL_COMMANDS.length);
    expect(undescribed).toEqual([]);
  });

  it("every leaf declares examples and an output schema", async () => {
    const entries = await allEntries();
    const withoutExamples = entries
      .filter((entry) => entry.examples.length === 0)
      .map((entry) => entry.command);
    const withoutOutputSchema = entries
      .filter((entry) => entry.outputSchema === null)
      .map((entry) => entry.command);
    expect(entries.length).toBe(ALL_COMMANDS.length);
    expect({ withoutExamples, withoutOutputSchema }).toEqual({
      withoutExamples: [],
      withoutOutputSchema: [],
    });
  });

  it("declares an input schema on every command that accepts a JSON body", async () => {
    const entries = await allEntries();
    const acceptingBody = entries.filter((entry) => entry.args.some((arg) => arg.name === "body"));
    const withoutInputSchema = acceptingBody
      .filter((entry) => entry.inputSchema === null)
      .map((entry) => entry.command);
    expect(acceptingBody.map((entry) => entry.command)).toEqual([]);
    expect(withoutInputSchema).toEqual([]);
  });

  it("carries each server command's methods and the features they need", async () => {
    const entries = await allEntries();
    const requires = Object.fromEntries(
      entries
        .filter((entry) => entry.command === "metadata" || entry.command === "save")
        .map((entry) => [entry.command, entry.requires]),
    );
    expect(requires).toEqual({
      metadata: { methods: ["database.list", "database.get", "field.values"], features: [] },
      save: { methods: ["gitSync.branch", "gitSync.import"], features: ["remoteSync"] },
    });
  });

  it("reports null requires for exactly the commands that never touch a Metabase server", async () => {
    const entries = await allEntries();
    const local = entries.filter((entry) => entry.requires === null).map((entry) => entry.command);
    expect(local.toSorted()).toEqual([
      "auth status",
      "check",
      "skills get",
      "skills list",
      "skills path",
    ]);
  });
});

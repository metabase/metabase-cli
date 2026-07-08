import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineMetabaseCommand } from "../commands/runtime";
import main from "../main";

import { BASELINE_CAPABILITIES } from "./capabilities";
import { buildHelpEntry, buildHelpIndex, resolveCommandPath } from "./command-help";
import type { CommandHelpEntry } from "./command-help";

describe("buildHelpIndex", () => {
  it("walks lazy subCommands into full-path index entries", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "leaf", description: "a leaf" },
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
      commands: [{ command: "group leaf", description: "a leaf" }],
    });
  });

  it("skips commands marked meta.hidden = true (and their subtrees)", async () => {
    const visible = defineMetabaseCommand({
      meta: { name: "visible", description: "visible" },
      args: {},
      run() {
        return;
      },
    });
    const hidden = defineMetabaseCommand({
      meta: { name: "hidden", description: "hidden", hidden: true },
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
      commands: [{ command: "visible", description: "visible" }],
    });
  });
});

describe("buildHelpEntry", () => {
  it("converts citty args to entries with type, required, default, alias, options", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "leaf", description: "leaf" },
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
      capabilities: BASELINE_CAPABILITIES,
    });
  });

  it("emits the JSON Schema of inputSchema for commands that declare a body contract", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "create", description: "create" },
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
      args: {},
      details: "the long per-command knowledge",
      run() {
        return;
      },
    });
    const without = defineMetabaseCommand({
      meta: { name: "without", description: "short" },
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
      args: {},
      skills: [{ skill: "mbql", purpose: "author the dataset_query" }],
      run() {
        return;
      },
    });
    const without = defineMetabaseCommand({
      meta: { name: "without", description: "short" },
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
  "card list",
  "card get",
  "card query",
  "card create",
  "card update",
  "card archive",
  "dashboard list",
  "dashboard get",
  "dashboard cards",
  "dashboard parameter-values",
  "dashboard create",
  "dashboard update",
  "dashboard update-dashcard",
  "dashboard archive",
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

const MEASURE_CAPABILITIES = { minVersion: 59 } as const;
const TRANSFORM_CAPABILITIES = { minVersion: 59 } as const;
const TRANSFORM_JOB_SET_ACTIVE_CAPABILITIES = { minVersion: 61 } as const;

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

  it("gates every measure command at v59 and keeps card commands at baseline", async () => {
    const entries = await allEntries();
    const measureCapabilities = Object.fromEntries(
      entries
        .filter((entry) => entry.command.startsWith("measure "))
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(measureCapabilities).toEqual({
      "measure list": MEASURE_CAPABILITIES,
      "measure get": MEASURE_CAPABILITIES,
      "measure create": MEASURE_CAPABILITIES,
      "measure update": MEASURE_CAPABILITIES,
      "measure archive": MEASURE_CAPABILITIES,
    });

    const cardList = entries.find((entry) => entry.command === "card list");
    expect(cardList?.capabilities).toEqual(BASELINE_CAPABILITIES);
  });

  it("carries the transform version gates through to every transform command", async () => {
    const entries = await allEntries();
    const transformCapabilities = Object.fromEntries(
      entries
        .filter(
          (entry) =>
            entry.command.startsWith("transform ") || entry.command.startsWith("transform-job "),
        )
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(transformCapabilities).toEqual({
      "transform list": TRANSFORM_CAPABILITIES,
      "transform get": TRANSFORM_CAPABILITIES,
      "transform dependencies": TRANSFORM_CAPABILITIES,
      "transform create": TRANSFORM_CAPABILITIES,
      "transform update": TRANSFORM_CAPABILITIES,
      "transform delete": TRANSFORM_CAPABILITIES,
      "transform run": TRANSFORM_CAPABILITIES,
      "transform runs": TRANSFORM_CAPABILITIES,
      "transform get-run": TRANSFORM_CAPABILITIES,
      "transform cancel": TRANSFORM_CAPABILITIES,
      "transform delete-table": TRANSFORM_CAPABILITIES,
      "transform-job list": TRANSFORM_CAPABILITIES,
      "transform-job get": TRANSFORM_CAPABILITIES,
      "transform-job create": TRANSFORM_CAPABILITIES,
      "transform-job update": TRANSFORM_CAPABILITIES,
      "transform-job delete": TRANSFORM_CAPABILITIES,
      "transform-job run": TRANSFORM_CAPABILITIES,
      "transform-job transforms": TRANSFORM_CAPABILITIES,
      "transform-job set-active": TRANSFORM_JOB_SET_ACTIVE_CAPABILITIES,
    });
  });

  it("reports null capabilities for local commands that never touch a Metabase server", async () => {
    const entries = await allEntries();
    const localCapabilities = Object.fromEntries(
      entries
        .filter((entry) => entry.command === "uuid" || entry.command === "upgrade")
        .map((entry) => [entry.command, entry.capabilities]),
    );
    expect(localCapabilities).toEqual({ uuid: null, upgrade: null });
  });
});

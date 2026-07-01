import { defineCommand } from "citty";
import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineMetabaseCommand } from "../commands/runtime";
import { BASELINE_CAPABILITIES } from "../core/version/capabilities";

import { buildManifest } from "./manifest";

describe("buildManifest", () => {
  it("walks lazy subCommands and emits one entry per leaf, joined by space", async () => {
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

    const manifest = await buildManifest(root);

    expect(manifest).toEqual({
      version: 1,
      commands: [
        {
          command: "group leaf",
          description: "a leaf",
          skills: [],
          examples: [],
          args: [],
          outputSchema: null,
          capabilities: BASELINE_CAPABILITIES,
        },
      ],
    });
  });

  it("converts citty args to manifest entries with type, required, default, alias, options", async () => {
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
    const root = defineCommand({
      meta: { name: "root" },
      subCommands: { leaf: () => Promise.resolve(leaf) },
    });

    const manifest = await buildManifest(root);

    expect(manifest.commands[0]?.args).toEqual([
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
    const root = defineCommand({
      meta: { name: "root" },
      subCommands: { leaf: () => Promise.resolve(leaf) },
    });

    const manifest = await buildManifest(root);

    expect(manifest).toEqual({
      version: 1,
      commands: [
        {
          command: "leaf",
          description: "leaf",
          skills: [],
          examples: ["root leaf --json"],
          args: [],
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
        },
      ],
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
    const root = defineCommand({
      meta: { name: "root" },
      subCommands: {
        with: () => Promise.resolve(withDetails),
        without: () => Promise.resolve(without),
      },
    });

    const manifest = await buildManifest(root);
    const withEntry = manifest.commands.find((entry) => entry.command === "with");
    const withoutEntry = manifest.commands.find((entry) => entry.command === "without");
    assert(withoutEntry !== undefined, "expected the 'without' entry in the manifest");
    expect(withEntry?.details).toBe("the long per-command knowledge");
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
    const root = defineCommand({
      meta: { name: "root" },
      subCommands: {
        with: () => Promise.resolve(withSkills),
        without: () => Promise.resolve(without),
      },
    });

    const manifest = await buildManifest(root);
    const withEntry = manifest.commands.find((entry) => entry.command === "with");
    const withoutEntry = manifest.commands.find((entry) => entry.command === "without");
    expect(withEntry?.skills).toEqual([{ skill: "mbql", purpose: "author the dataset_query" }]);
    expect(withoutEntry?.skills).toEqual([]);
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

    const manifest = await buildManifest(root);

    expect(manifest.commands.map((entry) => entry.command)).toEqual(["visible"]);
  });

  it("skips non-metabase leaf commands (raw defineCommand without augment)", async () => {
    const leaf = defineCommand({
      meta: { name: "leaf", description: "raw" },
      args: {},
      run() {
        return;
      },
    });
    const root = defineCommand({
      meta: { name: "root" },
      subCommands: { leaf: () => Promise.resolve(leaf) },
    });

    const manifest = await buildManifest(root);

    expect(manifest).toEqual({ version: 1, commands: [] });
  });
});

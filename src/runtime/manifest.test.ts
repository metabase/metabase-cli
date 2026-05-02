import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineMetabaseCommand } from "../commands/runtime";

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
          examples: [],
          args: [],
          outputSchema: null,
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
        },
      ],
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

    const manifest = await buildManifest(root);

    expect(manifest.commands.map((entry) => entry.command)).toEqual(["visible"]);
  });

  it("returns null outputSchema and empty examples for non-metabase leaf commands", async () => {
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

    expect(manifest).toEqual({
      version: 1,
      commands: [
        {
          command: "leaf",
          description: "raw",
          examples: [],
          args: [],
          outputSchema: null,
        },
      ],
    });
  });
});

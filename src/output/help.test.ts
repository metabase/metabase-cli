import { defineCommand } from "citty";
import type { ArgsDef, CommandDef } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { connectionFlags, outputFlags, profileFlag } from "../commands/flags";
import { defineMetabaseCommand } from "../commands/runtime";
import { BASELINE_CAPABILITIES } from "../runtime/capabilities";
import { setMetabaseAugment } from "../runtime/command-augment";
import { CommandHelpEntry, CommandHelpIndex } from "../runtime/command-help";
import { parseJson } from "../runtime/json";

import { findUnknownCommand, resolveBreadcrumb, showUsage, showUsageJson } from "./help";

describe("showUsage", () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk, encoding, callback) => {
      chunks.push(String(chunk));
      const done = typeof encoding === "function" ? encoding : callback;
      done?.(null);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips citty's '(<command name>)' breadcrumb suffix from the description line", async () => {
    const cmd = defineCommand({
      meta: { name: "demo", description: "Show authentication status for a profile" },
      args: { foo: { type: "string", description: "f" } },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Show authentication status for a profile");
    expect(out).not.toMatch(/\(demo[^)]*\)/);
  });

  it("preserves the rest of the help body", async () => {
    const cmd = defineCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: { foo: { type: "string", description: "the foo flag" } },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("USAGE");
    expect(out).toContain("--foo");
    expect(out).toContain("the foo flag");
  });

  it("appends an EXAMPLES section when defineMetabaseCommand declares examples", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      examples: ["mb demo --json", "mb demo --profile staging"],
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("EXAMPLES");
    expect(out).toContain("mb demo --json");
    expect(out).toContain("mb demo --profile staging");
  });

  it("omits the EXAMPLES section when no examples are declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).not.toContain("EXAMPLES");
  });

  it("renders the details block after the description and before USAGE when declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      args: {},
      details: "Longer per-command knowledge shown only on this page.",
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    const summaryIdx = out.indexOf("Short summary");
    const detailIdx = out.indexOf("Longer per-command knowledge shown only on this page.");
    const usageIdx = out.indexOf("USAGE");
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(detailIdx).toBeGreaterThan(summaryIdx);
    expect(usageIdx).toBeGreaterThan(detailIdx);
  });

  it("omits the details block when none is declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Short summary");
    expect(out).not.toContain("Longer per-command knowledge");
  });

  it("strips citty's column-padding whitespace from short rows so a long description does not bloat every line", async () => {
    const cmd = defineCommand({
      meta: { name: "root", description: "root cmd" },
      subCommands: {
        short: defineCommand({
          meta: { name: "short", description: "Short description" },
          run() {
            return;
          },
        }),
        long: defineCommand({
          meta: {
            name: "long",
            description:
              "This is a much, much longer description that forces citty's formatLineColumns to pad every other row with trailing spaces up to this length.",
          },
          run() {
            return;
          },
        }),
      },
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    const shortRow = out.split("\n").find((line) => line.includes("Short description"));
    expect(shortRow).toBeDefined();
    expect(shortRow).toMatch(/Short description$/);
  });

  it("appends a machine-readable help hint pointing at --help --json on a leaf page", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      args: {},
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    const out = chunks.join("");
    expect(out).toContain("Machine-readable help (flags, output schema): mb foo bar --help --json");
  });

  it("appends a machine-readable index hint on a command-group page", async () => {
    const root = defineCommand({
      meta: { name: "mb", description: "root cmd" },
      subCommands: {
        auth: defineCommand({ meta: { name: "auth", description: "auth" }, run() {} }),
      },
      run() {
        return;
      },
    });

    await showUsage(root, undefined, "mb");
    const out = chunks.join("");
    expect(out).toContain("Machine-readable command index: mb --help --json");
  });

  it("separates the EXAMPLES footer from the body with a blank line", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      examples: ["mb demo --json"],
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("\n\nEXAMPLES\n\n");
  });

  it("renders multi-character flag aliases as a single working --kebab form", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "list", description: "demo list" },
      args: { ...outputFlags, ...profileFlag, ...connectionFlags },
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("--max-bytes=<max_bytes>");
    expect(out).toContain("--api-key=<api_key>");
    expect(out).toContain("--skip-preflight");
    expect(out).not.toContain("--maxBytes");
    expect(out).not.toContain("--apiKey");
    expect(out).not.toContain("--skipPreflight");
    expect(out).not.toMatch(/(?<!-)-max-bytes/);
    expect(out).not.toMatch(/(?<!-)-skip-preflight/);
  });

  it("lists -h, --help in the OPTIONS block", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "list", description: "demo list" },
      args: { ...outputFlags, ...profileFlag, ...connectionFlags },
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("-h, --help");
    expect(out).toContain("Show help for this command");
  });

  it("prepends the full breadcrumb to a leaf USAGE line", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      args: { ...outputFlags },
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    const out = chunks.join("");
    expect(out).toContain("USAGE mb foo bar [OPTIONS]");
  });

  it("collapses a command group's USAGE subcommand pipe-list to <command>", async () => {
    const cmd = defineCommand({
      meta: { name: "mb", description: "root cmd" },
      subCommands: {
        auth: defineCommand({ meta: { name: "auth", description: "auth" }, run() {} }),
        card: defineCommand({ meta: { name: "card", description: "card" }, run() {} }),
      },
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb");
    const out = chunks.join("");
    expect(out).toContain("USAGE mb <command> [options]");
    expect(out).not.toContain("auth|card");
  });

  it("renders an AGENT SKILLS section from declared skill pointers, below the body", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "create", description: "demo create" },
      args: {},
      skills: [
        { skill: "mbql", purpose: "author the dataset_query" },
        { skill: "visualization", purpose: "choose display and settings" },
      ],
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("AGENT SKILLS");
    expect(out).toContain("mb skills get mbql — author the dataset_query");
    expect(out).toContain("mb skills get visualization — choose display and settings");
    expect(out.indexOf("AGENT SKILLS")).toBeGreaterThan(out.indexOf("USAGE"));
  });

  it("omits the AGENT SKILLS section when no skill pointers are declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "demo cmd" },
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    expect(chunks.join("")).not.toContain("AGENT SKILLS");
  });

  it("adds the `mb skills list` pointer only on the root AGENT SKILLS section", async () => {
    const root = defineCommand({
      meta: { name: "mb", description: "root cmd" },
      subCommands: {
        auth: defineCommand({ meta: { name: "auth", description: "auth" }, run() {} }),
      },
      run() {
        return;
      },
    });
    setMetabaseAugment(root, {
      examples: [],
      details: null,
      skills: [{ skill: "core", purpose: "auth and conventions" }],
      inputSchema: null,
      outputSchema: null,
      capabilities: null,
    });
    const leaf = defineMetabaseCommand({
      meta: { name: "list", description: "demo list" },
      args: {},
      skills: [{ skill: "core", purpose: "auth and conventions" }],
      run() {
        return;
      },
    });

    await showUsage(root, undefined, "mb");
    const rootOut = chunks.join("");
    chunks = [];
    await showUsage(leaf);
    const leafOut = chunks.join("");

    expect(rootOut).toContain("mb skills list — every bundled skill");
    expect(leafOut).toContain("AGENT SKILLS");
    expect(leafOut).not.toContain("mb skills list — every bundled skill");
  });

  it("adds a getting-started hint on the root help and omits it elsewhere", async () => {
    const root = defineCommand({
      meta: { name: "mb", description: "root cmd" },
      subCommands: {
        auth: defineCommand({ meta: { name: "auth", description: "auth" }, run() {} }),
      },
      run() {
        return;
      },
    });
    const leaf = defineMetabaseCommand({
      meta: { name: "list", description: "demo list" },
      args: {},
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(root, undefined, "mb");
    const rootOut = chunks.join("");
    chunks = [];
    await showUsage(leaf);
    const leafOut = chunks.join("");

    expect(rootOut).toContain("First time? Run `mb auth login` to connect to a Metabase instance.");
    expect(leafOut).not.toContain("First time?");
  });
});

describe("showUsageJson", () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk, encoding, callback) => {
      chunks.push(String(chunk));
      const done = typeof encoding === "function" ? encoding : callback;
      done?.(null);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the full entry for a leaf command", async () => {
    const leaf = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      args: {},
      outputSchema: z.object({ ok: z.boolean() }),
      examples: ["mb foo bar --json"],
      run() {
        return;
      },
    });

    await showUsageJson(leaf, "mb foo bar");
    const entry = parseJson(chunks.join(""), CommandHelpEntry, { source: "help json" });

    expect(entry).toEqual({
      command: "foo bar",
      description: "demo bar",
      skills: [],
      examples: ["mb foo bar --json"],
      args: [],
      inputSchema: null,
      outputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      capabilities: BASELINE_CAPABILITIES,
    });
  });

  it("emits a full-path index for a command group", async () => {
    const bar = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      args: {},
      run() {
        return;
      },
    });
    const baz = defineMetabaseCommand({
      meta: { name: "baz", description: "demo baz" },
      args: {},
      run() {
        return;
      },
    });
    const group = defineCommand({
      meta: { name: "foo", description: "demo group" },
      subCommands: {
        bar: () => Promise.resolve(bar),
        baz: () => Promise.resolve(baz),
      },
    });

    await showUsageJson(group, "mb foo");
    const index = parseJson(chunks.join(""), CommandHelpIndex, { source: "help json" });

    expect(index).toEqual({
      commands: [
        { command: "foo bar", description: "demo bar" },
        { command: "foo baz", description: "demo baz" },
      ],
    });
  });
});

describe("resolveBreadcrumb", () => {
  function tree(): CommandDef {
    const leaf = defineCommand({
      meta: { name: "bar" },
      args: { id: { type: "positional", required: false } },
    });
    const group = defineCommand({
      meta: { name: "foo", alias: "f" },
      subCommands: { bar: leaf },
    });
    return defineCommand<ArgsDef>({
      meta: { name: "mb" },
      args: { profile: { type: "string" } },
      subCommands: { foo: group },
    });
  }

  it("walks subcommand tokens into a full breadcrumb", async () => {
    expect(await resolveBreadcrumb(tree(), ["foo", "bar", "123"])).toBe("mb foo bar");
  });

  it("resolves a command alias to its canonical name", async () => {
    expect(await resolveBreadcrumb(tree(), ["f", "bar"])).toBe("mb foo bar");
  });

  it("skips a value-taking flag and its argument before the subcommand", async () => {
    expect(await resolveBreadcrumb(tree(), ["--profile", "staging", "foo", "bar"])).toBe(
      "mb foo bar",
    );
  });

  it("stops at the first unknown token", async () => {
    expect(await resolveBreadcrumb(tree(), ["nope", "bar"])).toBe("mb");
  });
});

describe("findUnknownCommand", () => {
  function tree(): CommandDef {
    const leaf = defineCommand({
      meta: { name: "bar" },
      args: { id: { type: "positional", required: false } },
    });
    const group = defineCommand({
      meta: { name: "foo", alias: "f" },
      subCommands: { bar: leaf },
    });
    return defineCommand<ArgsDef>({
      meta: { name: "mb" },
      args: { profile: { type: "string" } },
      subCommands: { foo: group },
    });
  }

  it("returns null for a valid subcommand path with a trailing positional", async () => {
    expect(await findUnknownCommand(tree(), ["foo", "bar", "123"])).toBeNull();
  });

  it("returns null when a command alias is used", async () => {
    expect(await findUnknownCommand(tree(), ["f", "bar"])).toBeNull();
  });

  it("returns null when only flags are present (a missing command, not an unknown one)", async () => {
    expect(await findUnknownCommand(tree(), ["--profile", "staging"])).toBeNull();
  });

  it("returns the unknown token at the root", async () => {
    expect(await findUnknownCommand(tree(), ["nope"])).toBe("nope");
  });

  it("returns the unknown token nested under a group", async () => {
    expect(await findUnknownCommand(tree(), ["foo", "frob"])).toBe("frob");
  });
});

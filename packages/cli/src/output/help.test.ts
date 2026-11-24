import { defineCommand } from "citty";
import type { ArgsDef, CommandDef } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { connectionFlags, outputFlags, profileFlag } from "../commands/flags";
import { defineCommandGroup } from "../commands/group";
import { defineMetabaseCommand } from "../commands/runtime";
import { setMetabaseAugment } from "../runtime/command-augment";
import { CommandHelpIndex } from "../runtime/command-help";
import { findUnknownCommand, resolveBreadcrumb, showUsage, showUsageJson } from "./help";

describe("showUsage", () => {
  let chunks: string[];
  let originalColumns: number | undefined;

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk, encoding, callback) => {
      chunks.push(String(chunk));
      const done = typeof encoding === "function" ? encoding : callback;
      done?.(null);
      return true;
    });
    originalColumns = process.stdout.columns;
    setColumns(80);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setColumns(originalColumns);
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
      requires: [],
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
      requires: [],
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).not.toContain("EXAMPLES");
  });

  it("prints a command's details in a DETAILS section after its options", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      requires: [],
      args: { limit: { type: "string", description: "Rows to return" } },
      details: "Longer per-command knowledge shown only on this page.",
      examples: ["mb demo"],
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toBe(
      [
        "Short summary",
        "",
        "USAGE demo [OPTIONS]",
        "",
        "OPTIONS",
        "",
        "  --limit=<limit>    Rows to return",
        "       -h, --help    Show help for this command",
        "",
        "DETAILS",
        "",
        "  Longer per-command knowledge shown only on this page.",
        "",
        "EXAMPLES",
        "",
        "  mb demo",
        "",
        "Machine-readable help (flags): demo --help --json",
        "",
      ].join("\n"),
    );
  });

  it("prints Markdown bold text without its marks", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Open **Admin** settings" },
      requires: [],
      args: {},
      details: "Find it in **Admin** > **Settings** > **API keys**.",
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Open Admin settings\n");
    expect(out).toContain("\n  Find it in Admin > Settings > API keys.\n");
  });

  it("prints a group's details after its commands, each heading over its own indented text and each link as its text", async () => {
    const list = defineMetabaseCommand({
      meta: { name: "list", description: "List things" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });
    const group = defineCommandGroup({
      name: "demo",
      description: "Manage demos",
      details:
        "Demos are samples.\n\n## Rows\n\nSee [`mb demo list`](#mb-demo-list) and [rows](rows.md#more).",
      subCommands: { list: () => Promise.resolve(list) },
    });

    await showUsage(group);
    const out = chunks.join("");
    expect(out).toBe(
      [
        "Manage demos",
        "",
        "USAGE demo <command> [options]",
        "",
        "COMMANDS",
        "",
        "  list    List things",
        "",
        "Use demo <command> --help for more information about a command.",
        "",
        "DETAILS",
        "",
        "  Demos are samples.",
        "",
        "  Rows",
        "",
        "    See `mb demo list` and rows.",
        "",
        "First time? Run `mb auth login` to connect to a Metabase instance.",
        "",
        "Machine-readable command index: demo --help --json",
        "",
      ].join("\n"),
    );
  });

  it("wraps each paragraph of the details to the terminal width, under its indent", async () => {
    setColumns(40);
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      requires: [],
      args: {},
      details: "Each paragraph wraps at a word boundary so that every line keeps its indent.",
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain(
      [
        "DETAILS",
        "",
        "  Each paragraph wraps at a word",
        "  boundary so that every line keeps its",
        "  indent.",
        "",
      ].join("\n"),
    );
  });

  it("keeps each table row of the details on its own line", async () => {
    setColumns(40);
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      requires: [],
      args: {},
      details:
        "| Code | When |\n| --- | --- |\n| `2` | A flag is wrong, or the body is malformed. |",
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain(
      [
        "DETAILS",
        "",
        "  | Code | When |",
        "  | --- | --- |",
        "  | `2` | A flag is wrong, or the body is malformed. |",
        "",
      ].join("\n"),
    );
  });

  it("keeps the `**` of a glob", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Sync files" },
      requires: [],
      args: {},
      details: "Reads `models/**/*.yaml` and `metrics/**/*.yaml`.",
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Reads `models/**/*.yaml` and `metrics/**/*.yaml`.\n");
  });

  it("omits the DETAILS section when no details are declared", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "demo", description: "Short summary" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd);
    const out = chunks.join("");
    expect(out).toContain("Short summary");
    expect(out).not.toContain("DETAILS");
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

  it("points a leaf with a body and an output at its help JSON and both schemas", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      requires: [],
      args: {},
      inputSchema: z.object({ name: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    expect(trailingLines(chunks.join(""), 2)).toEqual([
      "Machine-readable help (flags): mb foo bar --help --json",
      "Body and output schemas: mb schema foo bar [--output]",
    ]);
  });

  it("labels a leaf without a body as flags only and points at its output schema", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      requires: [],
      args: {},
      outputSchema: z.object({ ok: z.boolean() }),
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    expect(trailingLines(chunks.join(""), 2)).toEqual([
      "Machine-readable help (flags): mb foo bar --help --json",
      "Output schema: mb schema foo bar --output",
    ]);
  });

  it("points a leaf with only a body at its body schema", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      requires: [],
      args: {},
      inputSchema: z.object({ name: z.string() }),
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    expect(trailingLines(chunks.join(""), 2)).toEqual([
      "Machine-readable help (flags): mb foo bar --help --json",
      "Body schema: mb schema foo bar",
    ]);
  });

  it("labels a leaf with a documents body as flags only and points at its body schema", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      requires: [],
      args: {},
      inputDocuments: {
        title: "Demo query",
        command: ["foo", "bar"],
        bundle: { schema: { type: "object" }, defs: {} },
      },
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    expect(trailingLines(chunks.join(""), 2)).toEqual([
      "Machine-readable help (flags): mb foo bar --help --json",
      "Body schema: mb schema foo bar",
    ]);
  });

  it("leaves the schema hint off a leaf that declares neither schema", async () => {
    const cmd = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });

    await showUsage(cmd, undefined, "mb foo bar");
    expect(trailingLines(chunks.join(""), 2)).toEqual([
      "",
      "Machine-readable help (flags): mb foo bar --help --json",
    ]);
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
      requires: [],
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
      requires: [],
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
      requires: [],
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
      requires: [],
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
      requires: [],
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
      requires: [],
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
      input: null,
      outputSchema: null,
      requires: null,
    });
    const leaf = defineMetabaseCommand({
      meta: { name: "list", description: "demo list" },
      requires: [],
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
      requires: [],
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
      requires: ["card.list"],
      args: {},
      outputSchema: z.object({ ok: z.boolean() }),
      examples: ["mb foo bar --json"],
      run() {
        return;
      },
    });

    await showUsageJson(leaf, "mb foo bar");
    const entry = parseJson(chunks.join(""), z.unknown(), { source: "help json" });

    expect(entry).toEqual({
      command: "foo bar",
      description: "demo bar",
      skills: [],
      examples: ["mb foo bar --json"],
      args: [],
      requires: { methods: ["card.list"], features: [] },
    });
  });

  it("emits the group's own description and skills alongside a full-path index", async () => {
    const bar = defineMetabaseCommand({
      meta: { name: "bar", description: "demo bar" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });
    const baz = defineMetabaseCommand({
      meta: { name: "baz", description: "demo baz" },
      requires: [],
      args: {},
      run() {
        return;
      },
    });
    const group = defineCommandGroup({
      name: "foo",
      description: "demo group",
      skills: [{ skill: "mbql", purpose: "author the dataset_query" }],
      subCommands: {
        bar: () => Promise.resolve(bar),
        baz: () => Promise.resolve(baz),
      },
    });

    await showUsageJson(group, "mb foo");
    const index = parseJson(chunks.join(""), CommandHelpIndex, { source: "help json" });

    expect(index).toEqual({
      description: "demo group",
      skills: [{ skill: "mbql", purpose: "author the dataset_query" }],
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

// The page ends in a newline, so its last lines are the ones before the empty tail.
function trailingLines(page: string, count: number): string[] {
  return page.split("\n").slice(-count - 1, -1);
}

function setColumns(columns: number | undefined): void {
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
}
